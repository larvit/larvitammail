'use strict';

const	topLogPrefix	= 'larvitammail: ./index.js: ',
	async	= require('async'),
	mail	= require('larvitmail'),
	log	= require('winston'),
	fs	= require('fs'),
	_	= require('lodash');

function Mailer(options) {
	this.options	= options;
	this.subscriptions 	= {};
	this.intercom	= options.intercom;
	mail.setup(options.mailConfig);
};

Mailer.prototype.start = function(cb) {
	const	logPrefix	= topLogPrefix + 'Mailer.prototype.start() - ',
		tasks	= [],
		that	= this;

	tasks.push(ready);

	tasks.push(function(cb) {
		const	tasks	= [];

		for (const exchange in that.subscriptions) {
			tasks.push(function(cb) {
				const	options	= {'exchange': exchange};
				intercom.subscribe(options, function(message, ack) {
					ack();

					if (that.subscriptions[exchange].actions.includes(message.action)) {
						const	tasks	= [];

						let	mailData;;

						// Looking for data extension
						tasks.push(function (cb) {
							const extensionPath = process.cwd() + '/extensions/' + exchange + '/' + message.action + '.js';

							fs.stat(extensionPath, (err) => {
								if (err) {
									log.info(logPrefix + 'No data extension found for action ' + message.action);
									return cb(err);
								} else {
									const	extension = require(extensionPath);

									log.info(logPrefix + 'Data extension found for action: ' + message.action);

									extension.run(message.params, function(err, data) {
										mailData = data;
										return cb(err);
									});
								}
							});
						});

						// Render template
						tasks.push(function (cb) {
							let templatePath = process.cwd() + '/templates/';

							if (mailData.notSend !== undefined && mailData.notSend === true) {
								return cb();
							}

							if (mailData.template !== undefined) {
								templatePath += mailData.template;
							} else {
								templatePath += exchange + '/' + message.action + '.tmpl';
							}

							fs.readFile(templatePath, (err, template) => {
								if (err) return cb(err);
								const	render	= _.template(template);

								mailData.text	= render({'data': mailData.templateData});
								cb();
							});
						});

						// Send email.
						tasks.push(function (cb) {
							if (mailData.notSend !== undefined && mailData.notSend === true) {
								log.info(logPrefix + 'notSend-flag set and will not send email for action: ' + message.action);
								return cb();
							}
							delete mailData.templateData;
							mail.getInstance().send(mailData, function(err) {
								if (err) return cb(err);
								log.info(logPrefix + 'Email sent to ' + mailData.to + ' for action: ' + message.action);
								return cb();
							});
						});

						async.series(tasks, cb);
					}
				}, cb);
			});
		}

		async.series(tasks, cb);
	});

	async.series(tasks, cb);
};

exports = module.exports = Mailer;
