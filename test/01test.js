'use strict';

const stubTransport = require('nodemailer-stub-transport');
const Intercom = require('larvitamintercom');
const AmMail = require('../index.js');
const assert = require('assert');
const sinon = require('sinon');
const Mail = require('larvitmail');

// Set current working directory to make sure subscriptions-folders are found correctly
process.chdir(__dirname);

let mailStub;
let sendStub;

// Silent logger
const log = {
	info: () => {},
	warn: () => {},
	error: () => {},
	verbose: () => {},
	debug: () => {},
	silly: () => {}
};

beforeEach(function () {
	sendStub = sinon.stub();

	mailStub = {
		send: sendStub
	};
});

afterEach(function () {
	sinon.restore();
});

describe('Basics', function () {
	const subPath = __dirname + '/subscriptions';

	let mail;

	beforeEach(() => {
		mail = new Mail({
			transportConf: stubTransport(),
			mailDefaults: {
				from: 'foo@bar.com'
			},
			log
		});
	});

	it('get actions', function (done) {
		const amMail = new AmMail({mail, log});

		amMail.getActions(subPath, function (err, subscriptions) {
			if (err) throw err;

			assert.strictEqual(Object.keys(subscriptions).length, 2);
			assert.strictEqual(Object.keys(subscriptions.foo).length, 2);
			assert.strictEqual(Object.keys(subscriptions.testExchange).length, 1);
			assert.notStrictEqual(subscriptions.foo.bar, undefined);
			assert.notStrictEqual(subscriptions.foo.blubb, undefined);
			assert.notStrictEqual(subscriptions.testExchange.testAction, undefined);
			assert.strictEqual(typeof subscriptions.foo.bar, 'function');
			assert.strictEqual(typeof subscriptions.foo.blubb, 'function');
			assert.strictEqual(typeof subscriptions.testExchange.testAction, 'function');

			done();
		});
	});

	it('auto-resolve template path', function (done) {
		const amMail = new AmMail({mail, log});

		amMail.resolveTemplatePath(subPath, 'foo', 'blubb', {to: 'nisse@blubb.com'}, function (err, templatePath) {
			if (err) throw err;

			assert.strictEqual(templatePath, subPath + '/foo/blubb.tmpl');
			done();
		});
	});

	it('fail to auto-resolve template path when no template exists', function (done) {
		const amMail = new AmMail({mail, log});

		amMail.resolveTemplatePath(subPath, 'foo', 'bar', {to: 'nisse@blubb.com'}, function (err, templatePath) {
			assert.strictEqual(templatePath, undefined);
			assert.strictEqual(err instanceof Error, true);

			done();
		});
	});

	it('accept custom template path when template file exists', function (done) {
		const customTemplatePath = subPath + '/testExchange/custom.tmpl';
		const options = {};
		const amMail = new AmMail({mail, log});

		options.to = 'nisse@blubb.com';
		options.templatePath = customTemplatePath;

		amMail.resolveTemplatePath(subPath, 'foo', 'blubb', options, function (err, templatePath) {
			if (err) throw err;

			assert.strictEqual(templatePath, customTemplatePath);
			done();
		});
	});

	it('fail to accept custom template path when template file does not exists', function (done) {
		const customTemplatePath = subPath + '/testExchange/wupp.tmpl';
		const options = {};
		const amMail = new AmMail({mail, log});

		options.to = 'nisse@blubb.com';
		options.templatePath = customTemplatePath;

		amMail.resolveTemplatePath(subPath, 'foo', 'blubb', options, function (err, templatePath) {
			assert.strictEqual(templatePath, undefined);
			assert.strictEqual(err instanceof Error, true);

			done();
		});
	});
});

describe('Integration', function () {
	it('listen to a subscription, send a mail and dont crash', function (done) {
		const intercom = new Intercom('loopback interface');
		const mail = new Mail({
			transportConf: stubTransport(),
			mailDefaults: {
				from: 'foo@bar.com'
			},
			log
		});
		const amMail = new AmMail({ intercom, mail, log }, function (err) { if (err) throw err; });

		amMail.ready(function (err) {
			if (err) throw err;

			intercom.send({action: 'blubb'}, {exchange: 'foo'}, function (err) {
				if (err) throw err;

				amMail.emitter.on('mailSent', function (mailData) {
					assert.strictEqual(mailData.to, 'foo@blubb.org');
					assert.strictEqual(mailData.text, 'Testing 123 Bosse tut\n');

					done();
				});
			});
		});
	});

	it('resends mail on failure', function (done) {
		const intercom = new Intercom('loopback interface');
		const amMail = new AmMail({
			intercom: intercom,
			mail: mailStub,
			resend: {
				intervalMs: 1
			}}, function (err) { if (err) throw err; });

		sendStub.onFirstCall().yieldsAsync(new Error('Failed to send'));
		sendStub.onSecondCall().yieldsAsync(undefined);

		amMail.ready(function (err) {
			if (err) throw err;

			intercom.send({action: 'blubb'}, {exchange: 'foo'}, function (err) {
				if (err) throw err;

				amMail.emitter.on('mailSent', function (mailData) {
					assert.strictEqual(mailData.to, 'foo@blubb.org');
					assert.strictEqual(mailData.text, 'Testing 123 Bosse tut\n');

					done();
				});
			});
		});
	});
});
