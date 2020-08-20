'use strict';

const EventEmitter = require('events');
const Intercom = require('larvitamintercom');
const LUtils = require('larvitutils');
const async = require('async');
const fs = require('fs');

const topLogPrefix = 'larvitammail: index.js: ';
const defaultResendTries = 3;

/**
 * Options for Mailer instance.
 * @param {object} options - Mailer options
 * @param {string} options.mail - A larvitmail compatible instance
 * @param {object} [options.intercom] - A larvitamintercom compatible instance, defaults to loopback interface if not set
 * @param {object} [options.lUtils] - Instance of larvitutils. Will be created if not set
 * @param {object} [options.log] - Instans of logger. Will default to larvitutils logger if not set
 * @param {function} [cb] - Callback function, called with cb(err) where err will indicate any error during instantiation
 */
function Mailer(options, cb) {
	const logPrefix = topLogPrefix + 'Mailer() - ';

	if (options === undefined) {
		options = {};
	}

	if (!options.mail) throw new Error('Missing required option "mail"');

	options.lUtils = options.lUtils || new LUtils();
	options.log = options.log || new options.lUtils.Log('info');
	options.intercom = options.intercom || new Intercom('loopback interface');

	this.options = options;

	this.templates = {};
	this.emitter = new EventEmitter();
	this.intercom = options.intercom;
	this.mail = options.mail;
	this.log = options.log;
	this.resend = options.resend || {};
	this.resend.enabled = (this.resend.enabled !== undefined) ? this.resend.enabled : true;
	this.resend.intervalMs = this.resend.intervalMs || 120000;
	this.resend.tries = this.resend.tries !== undefined ? this.resend.tries : defaultResendTries;
	this.subscribed = false;
	this.subscriptionInProgress = false;
	this.subscriptions = {};

	this.emitter.setMaxListeners(30);

	this.log.verbose(logPrefix + 'intercom and mail is set, run registerSubscriptions()');
	this.registerSubscriptions(cb);
};

Mailer.prototype.getActions = function getActions(subPath, cb) {
	const that = this;
	const subscriptions = {};
	const logPrefix = topLogPrefix + 'getActions() - ';

	fs.readdir(subPath, function (err, exchanges) {
		const tasks = [];

		if (err) {
			that.log.warn(logPrefix + 'Could not read subscriptions dir: "' + subPath + '", err: ' + err.message);

			return cb(err);
		}

		// For each exchange, list actions
		for (let i = 0; exchanges[i] !== undefined; i++) {
			const exchange = exchanges[i];
			const exPath = subPath + '/' + exchange;

			tasks.push(function (cb) {
				fs.readdir(exPath, function (err, actions) {
					if (err) {
						that.log.warn(logPrefix + 'Could not read actions for dir: "' + exPath + '", err: ' + err.message);

						return cb(err);
					}

					if (subscriptions[exchange] === undefined) {
						subscriptions[exchange] = {};
					}

					for (let i = 0; actions[i] !== undefined; i++) {
						const action = actions[i];

						if (action.substring(action.length - 3) === '.js') {
							const actPath = exPath + '/' + action;

							subscriptions[exchange][action.substring(0, action.length - 3)] = require(actPath);
						}
					}

					cb();
				});
			});
		}

		async.parallel(tasks, function (err) {
			cb(err, subscriptions);
		});
	});
};

Mailer.prototype.handleIncMsg = function handleIncMsg(subPath, exchange, message, ack) {
	const logPrefix = topLogPrefix + 'handleIncMsg() - exchange: "' + exchange + '", action: "' + message.action + '" - ';
	const tasks = [];
	const that = this;

	let templatePath;
	let mailData;
	let ackCalled = false;

	if (that.subscriptions[exchange][message.action] === undefined) {
		that.log.debug(logPrefix + 'No subscription found, ignoring');

		return ack();
	}

	// Run subscription function
	tasks.push(function (cb) {
		that.log.debug(logPrefix + 'Running subscription function');

		that.subscriptions[exchange][message.action](message, function (err, result) {
			if (err) {
				that.log.warn(logPrefix + 'Err running subscription function: ' + err.message);

				return cb(err);
			}

			that.log.debug(logPrefix + 'Subscription function ran');

			mailData = result;

			if (mailData.notSend === true) {
				that.log.debug(logPrefix + 'mailData.notSend === true - do not send this email');
			}

			cb();
		});
	});

	// Resolve template
	tasks.push(function (cb) {
		that.log.debug(logPrefix + 'Resolving template');

		if (mailData.notSend === true) {
			that.log.debug(logPrefix + 'notSend === true, do not proceed with resolving template');

			return cb();
		}

		that.resolveTemplatePath(subPath, exchange, message.action, mailData, function (err, result) {
			templatePath = result;

			if (!err) {
				that.log.debug(logPrefix + 'Template resolved');
			}

			cb(err);
		});
	});

	// Get template
	tasks.push(function (cb) {
		if (mailData.notSend === true) {
			that.log.debug(logPrefix + 'notSend === true, do not proceed');

			return cb();
		}

		fs.readFile(templatePath, 'utf8', function (err, sourceTemplate) {
			if (err) {
				that.log.error(logPrefix + 'Could not read templatePath: "' + templatePath + '", err: ' + err.message);

				return cb(err);
			}

			if (!sourceTemplate) {
				that.log.error(logPrefix + 'Could not find template');

				return cb();
			}


			that.templates[templatePath] = sourceTemplate;

			that.log.debug(logPrefix + 'Template found');

			cb();
		});
	});

	// Send email
	tasks.push(function (cb) {
		if (mailData.notSend === true) {
			that.log.debug(logPrefix + 'notSend === true, do not proceed with sending email');

			return cb();
		}

		that.log.debug(logPrefix + 'Trying to send email to: "' + mailData.to + '"');

		mailData.template = that.templates[templatePath];

		that.mail.send(mailData, function (err) {
			if (err) {
				// Resend email based on configuration (it would be better if we could use rabbitmq recover with delay but not sure if that is possible)
				message.resendCounter = message.resendCounter || 0;

				if (that.resend.enabled && that.resend.tries > message.resendCounter) {
					message.resendCounter++;

					const sendOptions = {
						exchange: exchange
					};
					const resendMessage = {
						action: message.action,
						params: message.params,
						resendCounter: message.resendCounter
					};

					setTimeout(function () {
						that.log.info(logPrefix + 'Resending email to: "' + mailData.to + '" with subject: "' + mailData.subject + '"');
						that.intercom.send(resendMessage, sendOptions, function (err) {
							if (err) {
								that.log.warn(logPrefix + 'Could not send resend-message to queue, exchange: "' + sendOptions.exchange + '", action: "' + resendMessage.action + '", err:' + err.message);
							}
						});

					}, that.resend.intervalMs);
				} else {
					that.log.info(logPrefix + 'Failed to successfully send email to: "' + mailData.to + '" with subject: "' + mailData.subject + '"');
					that.emitter.emit('failedToSendMail', err); // Mainly for testing purposes
				}

				ack();
				ackCalled = true;

				return cb(err);
			}

			that.log.verbose(logPrefix + 'Email sent to: "' + mailData.to + '" with subject: "' + mailData.subject + '"');

			that.emitter.emit('mailSent', mailData); // Mainly for testing purposes

			ack();
			ackCalled = true;

			return cb();
		});
	});

	async.series(tasks, function () {
		if (!ackCalled) {
			ack();
		}
	});
};

Mailer.prototype.ready = function ready(cb) {
	if (this.subscribed === true) return cb();

	this.emitter.once('subscribed', cb);
};

Mailer.prototype.registerSubscriptions = function registerSubscriptions(cb) {
	const logPrefix = topLogPrefix + 'Mailer.prototype.registerSubscriptions() - ';
	const subPath = process.cwd() + '/subscriptions';
	const tasks = [];
	const that = this;

	if (typeof cb !== 'function') {
		cb = function () {};
	}

	if (that.subscriptionInProgress === true) {
		const err = new Error(logPrefix + 'registration already in progress');
		return cb(err);
	}

	if (that.subscribed === true) {
		return cb();
	}

	that.subscriptionInProgress = true;

	if (!fs.existsSync(subPath)) {
		that.log.info(logPrefix + 'No subscriptions registered, could not find subscriptions path: "' + subPath + '"');

		return cb();
	}

	// Get exchanges and actions
	tasks.push(function (cb) {
		that.getActions(subPath, function (err, actions) {
			that.subscriptions = actions;
			cb(err);
		});
	});

	// For each action, register functions and send mails etc
	tasks.push(function (cb) {
		const tasks = [];

		for (const exchange of Object.keys(that.subscriptions)) {
			tasks.push(function (cb) {
				that.intercom.consume({exchange: exchange}, function (message, ack) {
					that.handleIncMsg(subPath, exchange, message, ack);
				}, cb);
			});
		}

		async.parallel(tasks, cb);
	});

	async.series(tasks, function (err) {
		that.subscriptionInProgress = false;
		if (!err) {
			that.subscribed = true;
			that.emitter.emit('subscribed');
		}
		cb(err);
	});
};

Mailer.prototype.resolveTemplatePath = function resolveTemplatePath(subPath, exchange, action, mailData, cb) {
	const that = this;
	const logPrefix = topLogPrefix + 'Mailer.prototype.resolveTemplatePath() - ';

	let templatePath;

	if (mailData.templatePath === undefined) {
		templatePath = subPath + '/' + exchange + '/' + action + '.tmpl';
	} else {
		templatePath = mailData.templatePath;
	}

	if (!fs.existsSync(templatePath)) {
		const err = new Error('Mail template not found: "' + templatePath + '"');

		that.log.error(logPrefix + err.message);

		return cb(err);
	}

	cb(null, templatePath);
};

exports = module.exports = Mailer;
