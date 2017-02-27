'use strict';

// This file is ment to be run from PM2 to start a http server
// To test the server, use a custom script with configs to load
// the server model in a convenient way

// Make sure this is ran from the correct folder
process.chdir(__dirname);

const	subscriptions	= require('./config/subscriptions.json'),
	amqpConf	= require('./config/amqp.json'),
	logConf	= require('./config/log.json'),
	Intercom	= require('larvitamintercom'),
	intercom	=	new Intercom(amqpConf),
//	mailer	= require('larvitmail'),
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs'),
	_	= require('lodash');


// Add support for daily rotate file
log.transports.DailyRotateFile = require('winston-daily-rotate-file');

// Handle logging from config file
log.remove(log.transports.Console);
if (logConf !== undefined) {
	for (const logName of Object.keys(logConf)) {
		if (typeof logConf[logName] !== Array) {
			logConf[logName] = [logConf[logName]];
		}

		for (let i = 0; logConf[logName][i] !== undefined; i ++) {
			log.add(log.transports[logName], logConf[logName][i]);
		}
	}
}

intercom.ready(function() {
	const	tasks	= [];
	for (let exchange in subscriptions) {
		tasks.push(function(cb) {
			const	options	= {'exchange': exchange};
			intercom.subscribe(options, function(message, ack) {
				ack();
				if (subscriptions[exchange].actions.includes(message.action)) {
					getTemplate(message.action, function(err, template) {
						let	mail	= _.template(template);
						console.log(mail({'data': message.action}));
					});
				}
			}, function(err) {
				cb(err);
			});
		});
	}

	async.parallel(tasks, function(err) {
		if (err) throw err;
	});
});

function getTemplate(action, cb) {
	fs.readFile('./templates/' + action + '.tmpl', (err, data) => {
		cb(err, data);
	});
};
