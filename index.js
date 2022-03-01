'use strict';

const EventEmitter = require('events');
const Intercom = require('larvitamintercom');
const { Log } = require('larvitutils');
const async = require('async');
const fs = require('fs');

const topLogPrefix = 'larvitammail: index.js:';
const defaultResendTries = 3;

class Mailer {

	/**
	 * Options for Mailer instance.
	 * @param {object} options - Mailer options
	 * @param {string} options.mail - A larvitmail compatible instance
	 * @param {object} [options.intercom] - A larvitamintercom compatible instance, defaults to loopback interface if not set
	 * @param {object} [options.log] - Instans of logger. Will default to larvitutils logger if not set
	 */
	constructor(options) {
		if (options === undefined) {
			options = {};
		}

		if (!options.mail) throw new Error('Missing required option "mail"');

		options.intercom = options.intercom || new Intercom('loopback interface');

		this.options = options;

		this.templates = {};
		this.emitter = new EventEmitter();
		this.intercom = options.intercom;
		this.mail = options.mail;
		this.log = options.log || new Log('info');
		this.resend = options.resend || {};
		this.resend.enabled = (this.resend.enabled !== undefined) ? this.resend.enabled : true;
		this.resend.intervalMs = this.resend.intervalMs || 120000;
		this.resend.tries = this.resend.tries !== undefined ? this.resend.tries : defaultResendTries;
		this.subscribed = false;
		this.subscriptionInProgress = false;
		this.subscriptions = {};

		this.emitter.setMaxListeners(30);
	};

	async getPathConent(subPath) {
		const logPrefix = `${topLogPrefix} getPathConent() -`;

		try {
			const content = await fs.promises.readdir(subPath);
			return content;
		} catch (err) {
			this.log.warn(`${logPrefix} Could not read dir: "${subPath}", err: ${err.message}`);
			throw err;
		}
	}

	async getActions(subPath) {
		const logPrefix = `${topLogPrefix} getActions() -`;
		const subscriptions = {};

		const exchanges = await this.getPathConent(subPath);
		const tasks = [];

		this.log.info(`${logPrefix} Found exchanges: ${JSON.stringify(exchanges)}`);

		// For each exchange, list actions
		for (const exchange of exchanges) {
			const exPath = subPath + '/' + exchange;

			tasks.push((async () => {
				const actions = await this.getPathConent(exPath);

				subscriptions[exchange] = subscriptions[exchange] || {};

				for (const action of actions) {
					if (action.substring(action.length - 3) === '.js') {
						const actPath = exPath + '/' + action;

						this.log.info(`${logPrefix} Found action in exchange "${exchange}": ${action}`);

						subscriptions[exchange][action.substring(0, action.length - 3)] = require(actPath);
					}
				}
			})());
		}

		await Promise.all(tasks);

		return subscriptions;
	};

	async runAction(exchange, message) {
		const logPrefix = `${topLogPrefix} runAction() -`;

		this.log.debug(`${logPrefix} Running subscription function`);

		try {
			const mailData = await this.subscriptions[exchange][message.action](message);

			this.log.debug(`${logPrefix} Subscription function ran`);

			return mailData;
		} catch (err) {
			const errWrap = new Error(`Error running subscription "${exchange}/${message.action}", err: ${err.message}`);
			this.log.warn(`${logPrefix} ${errWrap.message}`);
			this.emitter.emit('actionError', errWrap);

			throw errWrap;
		}
	}

	async handleIncMsg(subPath, exchange, message, ack) {
		const logPrefix = `${topLogPrefix} handleIncMsg() - exchange: "${exchange}", action: "${message.action}" -`;

		let ackCalled = false;
		try {
			if (!this.subscriptions[exchange][message.action]) {
				this.log.verbose(`${logPrefix} No subscription found, ignoring`);
				this.emitter.emit('actionNotFound', message.action);

				return ack();
			}

			// Run subscription function
			const mailData = await this.runAction(exchange, message);

			if (mailData.notSend === true) {
				const notSendMessage = 'mailData.notSend === true - do not send this email';
				this.log.verbose(`${logPrefix} ${notSendMessage}`);
				this.emitter.emit('mailNotSent', {
					action: message.action,
					exchange,
					infoMessage: notSendMessage,
					message
				});

				return ack();
			}

			// Resolve template
			this.log.debug(`${logPrefix} Resolving template`);
			const templatePath = this.resolveTemplatePath(subPath, exchange, message.action, mailData);
			this.log.debug(`${logPrefix} Template resolved`);

			// Get template
			if (!this.templates[templatePath]) {
				const sourceTemplate = await fs.promises.readFile(templatePath, 'utf8');
				this.templates[templatePath] = sourceTemplate;
				this.log.debug(`${logPrefix} Template found`);
			}

			// Send email
			this.log.debug(`${logPrefix} Trying to send email to: "${mailData.to}"`);
			mailData.template = this.templates[templatePath];

			try {
				await this.mail.send(mailData);
			} catch (err) {
				// Resend email based on configuration (it would be better if we could use rabbitmq recover with delay but not sure if this is possible)
				message.resendCounter = message.resendCounter || 0;

				if (this.resend.enabled && this.resend.tries > message.resendCounter) {
					message.resendCounter++;

					const sendOptions = {
						exchange: exchange
					};
					const resendMessage = {
						action: message.action,
						params: message.params,
						resendCounter: message.resendCounter
					};

					setTimeout(() => {
						this.log.info(`${logPrefix} Resending email to: "${mailData.to}" with subject: "${mailData.subject}"`);
						this.intercom.send(resendMessage, sendOptions, err => {
							// istanbul ignore if
							if (err) {
								this.log.warn(`${logPrefix} Could not send resend-message to queue, exchange: "${sendOptions.exchange}", action: "${resendMessage.action}", err:${err.message}`);
							}
						});

					}, this.resend.intervalMs);
				} else {
					this.log.warn(`${logPrefix} Failed to successfully send email to: "${mailData.to}" with subject: "${mailData.subject}"`);
					this.emitter.emit('failedToSendMail', err); // Mainly for testing purposes
				}

				ack();
				ackCalled = true;

				throw err;
			}

			this.log.verbose(`${logPrefix} Email sent to: "${mailData.to}" with subject: "${mailData.subject}"`);
			this.emitter.emit('mailSent', mailData); // Mainly for testing purposes

			ack();
			ackCalled = true;
		} catch (err) {
			this.log.verbose(`${logPrefix} Failed to handle message, err: ${err.message}`);
			if (!ackCalled) {
				ack();
			}
		}
	};

	ready() {
		if (this.subscribed) return;

		return new Promise(res => this.emitter.once('subscribed', res));
	};

	/**
	 * Wrapper arount EventEmitter.
	 * Events that can be emitted:
	 * - subscribed(), once subscriptions has been loaded
	 * - actionNotFound(action), when an action cannot be found in subscription
	 * - actionError(err), when there is an error running the subscription action
	 * - mailNotSent({
	 *     action: message.action,
	 *     exchange,
	 *     infoMessage: notSendMessage,
	 *     message
	 *   }), when mail is not being sent (due to notSend is set by the action in subscription)
	 * - failedToSendMail(err), when mail cannot be sent (even after retries)
	 * - mailSent(mailData), when mail has been sent
	 * @param {string} event - event name
	 * @param {function} fn - listener function to handle event
	 */
	on(event, fn) {
		this.emitter.on(event, fn);
	}

	off(event, fn) {
		this.emitter.off(event, fn);
	}

	/**
	 * See documentation for on(event, fn).
	 * @param {string} event -
	 * @param {function} fn -
	 */
	once(event, fn) {
		this.emitter.once(event, fn);
	}

	listenerCount() {
		return this.emitter.listenerCount();
	}

	async registerSubscriptions() {
		const logPrefix = `${topLogPrefix} Mailer.prototype.registerSubscriptions() -`;
		const subPath = `${process.cwd()}/subscriptions`;

		this.log.verbose(`${logPrefix} Running registerSubscriptions(), subscriptions path: ${subPath}`);

		if (this.subscriptionInProgress) {
			throw new Error(`${logPrefix} registration already in progress`);
		}

		if (this.subscribed) {
			this.log.verbose(`${logPrefix} Already subscribed`);

			return;
		}

		this.subscriptionInProgress = true;

		if (!fs.existsSync(subPath)) {
			this.log.info(logPrefix + 'No subscriptions registered, could not find subscriptions path: "' + subPath + '"');

			return;
		}

		// Get exchanges and actions
		this.subscriptions = await this.getActions(subPath);

		// For each action, register functions and send mails etc
		const tasks = [];

		for (const exchange of Object.keys(this.subscriptions)) {
			tasks.push(cb => {
				this.intercom.consume({ exchange: exchange }, (message, ack) => {
					this.handleIncMsg(subPath, exchange, message, ack);
				}, cb);
			});
		}

		await async.parallel(tasks);

		this.subscriptionInProgress = false;
		this.subscribed = true;
		this.emitter.emit('subscribed');
	};

	resolveTemplatePath(subPath, exchange, action, mailData) {
		const logPrefix = topLogPrefix + 'Mailer.prototype.resolveTemplatePath() - ';

		let templatePath;

		if (mailData.templatePath === undefined) {
			templatePath = subPath + '/' + exchange + '/' + action + '.tmpl';
		} else {
			templatePath = mailData.templatePath;
		}

		if (!fs.existsSync(templatePath)) {
			const err = new Error('Mail template not found: "' + templatePath + '"');

			this.log.error(logPrefix + err.message);

			throw err;
		}

		return templatePath;
	};
};

exports = module.exports = Mailer;
