'use strict';

const { Log } = require('larvitutils');
const AmMail = require('../index.js');
const assert = require('assert');
const Intercom = require('larvitamintercom');
const Mail = require('larvitmail');
const sinon = require('sinon');
const stubTransport = require('nodemailer-stub-transport');
const { EventEmitter } = require('stream');

// Set current working directory to make sure subscriptions-folders are found correctly
process.chdir(__dirname);

let mailStub;
let sendStub = sinon.stub();

// Silent logger
const log = new Log('verbose');

function emitMessage(options) {
	const { exchange, action, params, amMailOptions } = options;
	const intercom = new Intercom('loopback interface');
	const amMail = new AmMail({intercom, mail: mailStub, log, ...amMailOptions}, function (err) { if (err) throw err; });
	amMail.registerSubscriptions();

	amMail.ready().then(() => {
		intercom.send({action, params}, {exchange}, function (err) {
			if (err) throw err;
		});
	});

	return { intercom, amMail };
}

function failOnException(done, fn) {
	try {
		fn();
	} catch (err) {
		return done(err);
	}

	done();
}

function verifySentMail(done, fn) {
	sendStub.callsFake(mailData => failOnException(done, () => fn(mailData)));
}

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

	it('throws error if larvitmail instance is not specified', async () => {
		assert.throws(() => new AmMail());
	});

	it('get actions', async () => {
		const amMail = new AmMail({mail, log});

		const subscriptions = await amMail.getActions(subPath);

		assert.strictEqual(Object.keys(subscriptions).length, 2);
		assert.strictEqual(Object.keys(subscriptions.foo).length, 4);
		assert.strictEqual(Object.keys(subscriptions.testExchange).length, 1);
		assert.notStrictEqual(subscriptions.foo.bar, undefined);
		assert.notStrictEqual(subscriptions.foo.blubb, undefined);
		assert.notStrictEqual(subscriptions.foo.error, undefined);
		assert.notStrictEqual(subscriptions.foo.notSend, undefined);
		assert.notStrictEqual(subscriptions.testExchange.testAction, undefined);
		assert.strictEqual(typeof subscriptions.foo.bar, 'function');
		assert.strictEqual(typeof subscriptions.foo.blubb, 'function');
		assert.strictEqual(typeof subscriptions.testExchange.testAction, 'function');
	});

	it('should throw when trying to get actions for a bad path', async () => {
		const amMail = new AmMail({mail, log});

		await assert.rejects(async () => await amMail.getActions('-what?'));
	});

	it('auto-resolve template path', function (done) {
		const amMail = new AmMail({mail, log});

		const templatePath = amMail.resolveTemplatePath(subPath, 'foo', 'blubb', {to: 'nisse@blubb.com'});
		assert.strictEqual(templatePath, subPath + '/foo/blubb.tmpl');
		done();
	});

	it('fail to auto-resolve template path when no template exists', function (done) {
		const amMail = new AmMail({mail, log});

		assert.throws(
			() => amMail.resolveTemplatePath(subPath, 'foo', 'bar', {to: 'nisse@blubb.com'}),
			err => err.message.includes('Mail template not found: "')
		);

		done();
	});

	it('accept custom template path when template file exists', function (done) {
		const customTemplatePath = subPath + '/testExchange/custom.tmpl';
		const options = {};
		const amMail = new AmMail({mail, log});

		options.to = 'nisse@blubb.com';
		options.templatePath = customTemplatePath;

		const templatePath = amMail.resolveTemplatePath(subPath, 'foo', 'blubb', options);
		assert.strictEqual(templatePath, customTemplatePath);
		done();
	});

	it('fail to accept custom template path when template file does not exists', function (done) {
		const customTemplatePath = subPath + '/testExchange/wupp.tmpl';
		const options = {};
		const amMail = new AmMail({mail, log});

		options.to = 'nisse@blubb.com';
		options.templatePath = customTemplatePath;

		assert.throws(
			() => amMail.resolveTemplatePath(subPath, 'foo', 'blubb', options),
			err => err.message.includes('Mail template not found: "') && err.message.includes('testExchange/wupp.tmpl')
		);
		done();
	});

	it('should return immediatly from ready() when already subscribed', done => {
		const amMail = new AmMail({mail, log});

		// Really verified through coverage
		amMail.registerSubscriptions();
		amMail.on('subscribed', async () => {
			await amMail.ready();
			done();
		});
	});

	it('should be able to remove listener from event emitter', done => {
		const amMail = new AmMail({mail, log});
		const ee = new EventEmitter();

		let subscribed = false;

		const onSubscribed = () => {
			subscribed = true;
			ee.emit('testReadyForValidation');
		};
		amMail.on('subscribed', onSubscribed);

		ee.on('testReadyForValidation', () => failOnException(done, () => {
			assert.strictEqual(subscribed, true, 'subscribed should be set to true');

			amMail.off('subscribed', onSubscribed);
			assert.strictEqual(amMail.listenerCount(), 0);
		}));

		amMail.registerSubscriptions();
	});
});

describe('Integration', function () {
	it('listen to a subscription, send a mail once action is received', function (done) {
		verifySentMail(done, mailData => {
			assert.strictEqual(mailData.to, 'foo@blubb.org');
			assert.strictEqual(mailData.template, 'Testing 123 <%= username %> tut\n');
			assert.deepStrictEqual(mailData.templateData, { username: 'Bosse' });
		});

		emitMessage({
			exchange: 'foo',
			action: 'blubb'
		});
	});

	it('should handle action not being found in subscriptions', function (done) {
		const { amMail } = emitMessage({
			exchange: 'foo',
			action: 'korv'
		});

		amMail.once('actionNotFound', action => failOnException(done, () => {
			assert.strictEqual(action, 'korv');
			assert.ok(sendStub.notCalled, 'Mail should not have been sent when action cannot be found');
		}));
	});

	it('should handle error in subscription action', function (done) {
		const { amMail } = emitMessage({
			exchange: 'foo',
			action: 'error'
		});

		amMail.on('actionError', err => failOnException(done, () => {
			assert.strictEqual(err.message, 'Error running subscription "foo/error", err: Error from action');
			assert.ok(sendStub.notCalled, 'Mail should not have been sent when there is an error in action');
		}));
	});

	it('should not send mail when subscription action sets notSend', done => {
		const { amMail } = emitMessage({
			exchange: 'foo',
			action: 'notSend'
		});

		const verify = info => failOnException(done, () => {
			assert.strictEqual(info.exchange, 'foo');
			assert.strictEqual(info.action, 'notSend');
		});

		amMail.on('mailNotSent', verify);
	});

	it('resends mail on failure', function (done) {
		emitMessage({
			exchange: 'foo',
			action: 'blubb',
			amMailOptions: {
				resend: {
					intervalMs: 1
				}
			}
		});

		sendStub.onFirstCall().rejects(new Error('Failed to send'));

		sendStub.onSecondCall().callsFake(mailData => failOnException(done, () => {
			assert.strictEqual(mailData.to, 'foo@blubb.org');
			assert.strictEqual(JSON.stringify(mailData.templateData), '{"username":"Bosse"}');
			assert.strictEqual(mailData.template, 'Testing 123 <%= username %> tut\n');
		}));
	});

	it('try to resend mail 5 times before giving up', function (done) {
		const { amMail } = emitMessage({
			exchange: 'foo',
			action: 'blubb',
			amMailOptions: {
				resend: {
					intervalMs: 1,
					tries: 5
				}
			}
		});

		const finalErr = new Error('Failed to send (5)');

		sendStub.onCall(0).rejects(new Error('Failed to send (0)'));
		sendStub.onCall(1).rejects(new Error('Failed to send (1)'));
		sendStub.onCall(2).rejects(new Error('Failed to send (2)'));
		sendStub.onCall(3).rejects(new Error('Failed to send (3)'));
		sendStub.onCall(4).rejects(new Error('Failed to send (4)'));
		sendStub.onCall(5).rejects(finalErr);

		assert.ok(sendStub.notCalled, 'Mail should not have been sent');

		amMail.on('failedToSendMail', err => failOnException(done, () => {
			assert.strictEqual(err.message, finalErr.message);
		}));
	});

	it('try to resend mail 10 times before successful', function (done) {
		const { amMail } = emitMessage({
			exchange: 'foo',
			action: 'blubb',
			amMailOptions: {
				resend: {
					intervalMs: 1,
					tries: 10
				}
			}
		});

		sendStub.onCall(0).rejects(new Error('Failed to send'));
		sendStub.onCall(1).rejects(new Error('Failed to send'));
		sendStub.onCall(2).rejects(new Error('Failed to send'));
		sendStub.onCall(3).rejects(new Error('Failed to send'));
		sendStub.onCall(4).rejects(new Error('Failed to send'));
		sendStub.onCall(5).rejects(new Error('Failed to send'));
		sendStub.onCall(6).rejects(new Error('Failed to send'));
		sendStub.onCall(7).rejects(new Error('Failed to send'));
		sendStub.onCall(8).rejects(new Error('Failed to send'));
		sendStub.onCall(9).rejects(new Error('Failed to send'));

		sendStub.onCall(10).callsFake(mailData => failOnException(done, () => {
			assert.strictEqual(mailData.to, 'foo@blubb.org');
			assert.strictEqual(JSON.stringify(mailData.templateData), '{"username":"Bosse"}');
			assert.strictEqual(mailData.template, 'Testing 123 <%= username %> tut\n');
		}));

		amMail.on('failedToSendMail', function (err) {
			throw new Error('Should not have failed! ' + err.message);
		});
	});

	it('fail to send mail without any resend tries', function (done) {
		const { amMail } = emitMessage({
			exchange: 'foo',
			action: 'blubb',
			amMailOptions: {
				resend: {
					intervalMs: 1,
					tries: 0
				}
			}
		});

		const finalErr = new Error('Failed to send');
		sendStub.onCall(0).rejects(finalErr);

		amMail.on('failedToSendMail', err => failOnException(done, () => {
			assert.strictEqual(err.message, finalErr.message);
		}));
	});

	it('fail to send mail with resend disabeld', function (done) {
		const { amMail } = emitMessage({
			exchange: 'foo',
			action: 'blubb',
			amMailOptions: {
				resend: {
					enabled: false
				}
			}
		});

		const finalErr = new Error('Failed to send');
		sendStub.onCall(0).rejects(finalErr);

		amMail.on('failedToSendMail', err => failOnException(done, () => {
			assert.strictEqual(err.message, finalErr.message);
		}));
	});
});
