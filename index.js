'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	mail	= require('larvitmail'),
	log	= require('winston'),
	fs	= require('fs'),
	_	= require('lodash');


let	readyInProgress	= false,
	isReady	= false,
	intercom,
	mailConfig;

function ready(cb) {
	const	tasks	= [];

	if (isReady === true) { cb(); return; }

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	readyInProgress = true;

	// Set intercom
	tasks.push(function(cb) {
		intercom	= lUtils.instances.mailerIntercom;
		cb();
	});

	// Set mailer
	tasks.push(function(cb) {
		mail.setup(mailConfig);
		cb();
	});

	async.series(tasks, function() {
		isReady	= true;
		eventEmitter.emit('ready');
		cb();
	});
}

function Mailer(options) {
	this.ready	= ready; // To expose to the outside world
	this.subscriptions 	= options.subscriptions;
	mailConfig	=	options.mailConfig;
};


Mailer.prototype.start = function(cb) {
	const	tasks	= [],
		that	= this;

	tasks.push(ready);


	tasks.push(function(cb) {
		const	tasks	= [];
		for (let exchange in that.subscriptions) {
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
									log.info('larvitammail - index.js: No data extension found for action ' + message.action);
									cb(err);
									return;
								} else {
									let extension;
									log.info('larvitammail - index.js: Data extension found for action ' + message.action);
									extension = require(extensionPath);
									extension.run(message.params, function(err, data) {
										mailData = data;
										cb(err);
									});
								}
							});
						});

						// Render template
						tasks.push(function (cb) {
							const templatePath = process.cwd() + '/templates/' + exchange + '/' + message.action + '.tmpl';
							fs.readFile(templatePath, (err, template) => {
								if (err) { cb(err); return; };
								let	render	= _.template(template);

								mailData.text	= render({'data': mailData.templateData});
								cb();
							});
						});

						// Send email.
						tasks.push(function (cb) {
							delete mailData.templateData;
							mail.getInstance().send(mailData, function(err) {
								if (err) throw err;
								log.info('larvitammail - index.js: Email sent to ' + mailData.to);
								cb();
							});
						});

						async.series(tasks, function(err) {
							if (err) { cb(err); return; };
						});
					}
				}, function(err) {
					cb(err);
				});
			});
		}

		async.series(tasks, function(err) {
			cb(err);
		});
	});

	async.series(tasks, function(err) {
		cb(err);
	});
};


exports = module.exports = Mailer;
