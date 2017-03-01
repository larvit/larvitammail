'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs'),
	_	= require('lodash');


let	readyInProgress	= false,
	isReady	= false,
	intercom;

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

	async.series(tasks, function() {
		isReady	= true;
		eventEmitter.emit('ready');
		cb();
	});
}

function Mailer(options) {
	this.ready	= ready; // To expose to the outside world
	this.subscriptions 	= options.subscriptions;
	this.mailConfig	=	options.mailConfig;
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

						let	templateData;

						// Looking for data extension
						tasks.push(function (cb) {
							const extensionPath = process.cwd() + '/extensions/' + exchange + '/' + message.action + '.js';

							fs.stat(extensionPath, (err) => {
								if (err) {
									log.info('larvitammail - index.js: No data extension found for action ' + message.action);
									cb(null);
								} else {
									let extension;
									log.info('larvitammail - index.js: Data extension found for action ' + message.action);
									extension = require(extensionPath);
									extension.run(message.params, function(err, data) {
										templateData = data;
										cb(err);
									});
								}
							});
						});

						// Get render template
						tasks.push(function (cb) {
							getTemplate(message.action, function (err, template) {
								if (err) { cb(err); return; };
								let	mail	= _.template(template);
								console.log(mail({'data': templateData}));
								cb();
							});
						});

						// Send email.
						tasks.push(function (cb) {
							console.log('Sending email...');
							cb();
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

function getTemplate(action, cb) {
	fs.readFile(process.cwd() + '/templates/' + action + '.tmpl', (err, data) => {
		cb(err, data);
	});
};


exports = module.exports = Mailer;
