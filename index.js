'use strict';

const	topLogPrefix	= 'larvitammail: ./index.js: ',
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs'),
	_	= require('lodash');

function Mailer(options, cb) {
	const	logPrefix	= topLogPrefix + 'Mailer() - ';

	if (options === undefined) {
		options	= {};
	}

	this.options	= options;
	this.subscriptions 	= {};
	this.intercom	= options.intercom;
	this.mail	= options.mail;
	this.compiledTemplates	= {};

	if (this.intercom && this.mail) {
		this.registerSubscriptions(cb);
	} else {
		log.info(logPrefix + 'Missing intercom and/or mail, not started!');
	}
};

Mailer.prototype.getActions = function getActions(subPath, cb) {
	const	subscriptions	= {},
		logPrefix	= topLogPrefix + 'getActions() - ';

	fs.readdir(subPath, function (err, exchanges) {
		const	tasks	= [];

		if (err) {
			log.warn(logPrefix + 'Could not read subscriptions dir: "' + subPath + '", err: ' + err.message);
			return cb(err);
		}

		// For each exchange, list actions
		for (let i = 0; exchanges[i] !== undefined; i ++) {
			const	exchange	= exchanges[i],
				exPath	= subPath + '/' + exchange;

			tasks.push(function (cb) {
				fs.readdir(exPath, function (err, actions) {
					if (err) {
						log.warn(logPrefix + 'Could not read actions for dir: "' + exPath + '", err: ' + err.message);
						return cb(err);
					}

					if (subscriptions[exchange] === undefined) {
						subscriptions[exchange] = {};
					}

					for (let i = 0; actions[i] !== undefined; i ++) {
						const	action	= actions[i];

						if (action.substring(action.length - 3) === '.js') {
							const	actPath	= exPath + '/' + action;

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

Mailer.prototype.resolveTemplatePath = function resolveTemplatePath(subPath, exchange, action, mailData, cb) {
	const	logPrefix	= topLogPrefix + 'Mailer.prototype.resolveTemplatePath() - ';

	let	templatePath;

	if (mailData.templatePath === undefined) {
		templatePath = subPath + '/' + exchange + '/' + action + '.tmpl';
	} else {
		templatePath = mailData.templatePath;
	}

	if ( ! fs.existsSync(templatePath)) {
		const	err	= new Error('Mail template not found: "' + templatePath + '"');
		log.error(logPrefix + err.message);
		return cb(err);
	}

	cb(null, templatePath);
};

Mailer.prototype.handleIncMsg = function handleIncMsg(subPath, exchange, message, ack) {
	const	logPrefix	= topLogPrefix + 'handleIncMsg() - exchange: "' + exchange + '", action: "' + message.action + '"',
		tasks	= [],
		that	= this;

	let	templatePath,
		mailData;

	if (that.subscriptions[exchange][message.action] === undefined) {
		log.debug(logPrefix + 'No subscription found, ignoring');
		return ack();
	}

	// Run subscription function
	tasks.push(function (cb) {
		that.subscriptions[exchange][message.action](message, function (err, result) {
			if (err) {
				log.warn(logPrefix + 'Err running subscription function: ' + err.message);
				return cb(err);
			}

			mailData	= result;

			if (mailData.notSend === true) {
				log.debug(logPrefix + 'mailData.notSend === true - do not send this email');
			}

			cb();
		});
	});

	// Resolve template
	tasks.push(function (cb) {
		if (mailData.notSend === true) return cb();

		that.resolveTemplatePath(subPath, exchange, message.action, mailData, function (err, result) {
			templatePath	= result;
			cb(err);
		});
	});

	// Compile template
	tasks.push(function (cb) {
		if (mailData.notSend	=== true	)	return cb();
		if (that.compiledTemplates[templatePath]	!== undefined	)	return cb();

		fs.readFile(templatePath, function (err, sourceTemplate) {
			if (err) return cb(err);

			try {
				that.compiledTemplates[templatePath] = _.template(sourceTemplate);
			} catch (err) {
				log.error(logPrefix + 'Could not compile template, err: ' + err.message);
				return cb(err);
			}

			cb();
		});
	});

	// Render template
	tasks.push(function (cb) {
		if (mailData.notSend === true) return cb();

		try {
			mailData.text	= that.compiledTemplates[templatePath](mailData.templateData);
		} catch (err) {
			log.error(logPrefix + 'Could not render template, err: ' + err.message);
			return cb(err);
		}

		cb();
	});

	// Send email
	tasks.push(function (cb) {
		if (mailData.notSend === true) return cb();

		delete mailData.templateData;
		that.mail.getInstance().send(mailData, function(err) {
			if (err) return cb(err);
			log.verbose(logPrefix + 'Email sent to: "' + mailData.to + '" with subject: "' + mailData.subject + '"');
			return cb();
		});
	});

	async.series(tasks, ack);
};

Mailer.prototype.registerSubscriptions = function registerSubscriptions(cb) {
	const	logPrefix	= topLogPrefix + 'Mailer.prototype.registerSubscriptions() - ',
		subPath	= process.pwd() + '/subscriptions',
		tasks	= [],
		that	= this;

	if ( ! fs.existsSync(subPath)) {
		log.info(logPrefix + 'No subscriptions registered, could not find subscriptions path: "' + subPath + '"');
		return cb();
	}

	// Get exchanges and actions
	tasks.push(function (cb) {
		that.getActions(subPath, function (err, actions) {
			that.subscriptions	= actions;
			cb(err);
		});
	});

	// For each action, register functions and send mails etc
	tasks.push(function (cb) {
		const	tasks	= [];

		for (const exchange of Object.keys(that.subscriptions)) {
			tasks.push(function (cb) {
				that.intercom.subscribe({'exchange': exchange}, function (message, ack) {
					that.handleIncMsg(subPath, exchange, message, ack);
				}, cb);
			});
		}

		async.parallel(tasks, cb);
	});
};

exports = module.exports = Mailer;
