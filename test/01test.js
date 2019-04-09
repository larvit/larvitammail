'use strict';

const	stubTransport	= require('nodemailer-stub-transport'),
	Intercom	= require('larvitamintercom'),
	AmMail	= require('../index.js'),
	assert	= require('assert'),
	sinon = require('sinon'),
	mail	= require('larvitmail'),
	log	= require('winston');

let mailStub,
	sendStub;

// Set up winston
log.remove(log.transports.Console);
/** /log.add(log.transports.Console, {
	'level':	'debug',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/**/

// Set current working directory to make sure subscriptions-folders are found correctly
process.chdir(__dirname);

beforeEach(function () {
	sendStub = sinon.stub();

	mailStub = {
		'getInstance': function () {
			return {'send': sendStub};
		}
	};
});

afterEach(function () {
	sinon.restore();
});

describe('Basics', function () {
	const	subPath	= __dirname + '/subscriptions';

	it('get actions', function (done) {
		const	amMail	= new AmMail();

		amMail.getActions(subPath, function (err, subscriptions) {
			if (err) throw err;

			assert.strictEqual(Object.keys(subscriptions).length,	2);
			assert.strictEqual(Object.keys(subscriptions.foo).length,	2);
			assert.strictEqual(Object.keys(subscriptions.testExchange).length,	1);
			assert.notStrictEqual(subscriptions.foo.bar,	undefined);
			assert.notStrictEqual(subscriptions.foo.blubb,	undefined);
			assert.notStrictEqual(subscriptions.testExchange.testAction,	undefined);
			assert.strictEqual(typeof subscriptions.foo.bar,	'function');
			assert.strictEqual(typeof subscriptions.foo.blubb,	'function');
			assert.strictEqual(typeof subscriptions.testExchange.testAction,	'function');

			done();
		});
	});

	it('auto-resolve template path', function (done) {
		const	amMail	= new AmMail();

		amMail.resolveTemplatePath(subPath, 'foo', 'blubb', {'to': 'nisse@blubb.com'}, function (err, templatePath) {
			if (err) throw err;

			assert.strictEqual(templatePath,	subPath + '/foo/blubb.tmpl');
			done();
		});
	});

	it('fail to auto-resolve template path when no template exists', function (done) {
		const	amMail	= new AmMail();

		amMail.resolveTemplatePath(subPath, 'foo', 'bar', {'to': 'nisse@blubb.com'}, function (err, templatePath) {
			assert.strictEqual(templatePath,	undefined);
			assert.strictEqual(err instanceof Error,	true);

			done();
		});
	});

	it('accept custom template path when template file exists', function (done) {
		const	customTemplatePath	= subPath + '/testExchange/custom.tmpl',
			options	= {},
			amMail	= new AmMail();

		options.to	= 'nisse@blubb.com';
		options.templatePath	= customTemplatePath;

		amMail.resolveTemplatePath(subPath, 'foo', 'blubb', options, function (err, templatePath) {
			if (err) throw err;

			assert.strictEqual(templatePath,	customTemplatePath);
			done();
		});
	});

	it('fail to accept custom template path when template file does not exists', function (done) {
		const	customTemplatePath	= subPath + '/testExchange/wupp.tmpl',
			options	= {},
			amMail	= new AmMail();

		options.to	= 'nisse@blubb.com';
		options.templatePath	= customTemplatePath;

		amMail.resolveTemplatePath(subPath, 'foo', 'blubb', options, function (err, templatePath) {
			assert.strictEqual(templatePath,	undefined);
			assert.strictEqual(err instanceof Error,	true);

			done();
		});
	});
});

describe('Integration', function () {
	it('listen to a subscription, send a mail and dont crash', function (done) {
		const	intercom	= new Intercom('loopback interface'),
			amMail	= new AmMail({'intercom': intercom, 'mail': mail}, function (err) { if (err) throw err;});

		mail.setup({
			'transportConf': stubTransport(),
			'mailDefaults': {
				'from':	'foo@bar.com'
			}
		});

		amMail.ready(function (err) {
			if (err) throw err;

			intercom.send({'action': 'blubb'}, {'exchange': 'foo'}, function (err) {
				if (err) throw err;

				amMail.emitter.on('mailSent', function (mailData) {
					assert.strictEqual(mailData.to,	'foo@blubb.org');
					assert.strictEqual(mailData.text,	'Testing 123 Bosse tut\n');

					done();
				});
			});
		});
	});

	it('resends mail on failure', function (done) {
		const	intercom	= new Intercom('loopback interface'),
			amMail	= new AmMail({
				'intercom': intercom,
				'mail': mailStub,
				'resend': {
					'intervalMs': 1
				}}, function (err) { if (err) throw err;});

		sendStub.onFirstCall().yieldsAsync(new Error('Failed to send'));
		sendStub.onSecondCall().yieldsAsync(undefined);

		amMail.ready(function (err) {
			if (err) throw err;

			intercom.send({'action': 'blubb'}, {'exchange': 'foo'}, function (err) {
				if (err) throw err;

				amMail.emitter.on('mailSent', function (mailData) {
					assert.strictEqual(mailData.to,	'foo@blubb.org');
					assert.strictEqual(mailData.text,	'Testing 123 Bosse tut\n');

					done();
				});
			});
		});
	});
});
