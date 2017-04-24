'use strict';

/*
const	mailConfig	= require(__dirname + '/../config/mailConf_test.json'),
	Intercom	= require('larvitamintercom'),
	Mailer	= require('../index.js'),
	assert	= require('assert'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs');

let	intercom;

// Set up winston
log.remove(log.transports.Console);
/** /log.add(log.transports.Console, {
	'level':	'warn',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/ ** /

before(function(done) {
	this.timeout(10000);
	const	tasks	= [];

	// Setup intercom
	tasks.push(function(cb) {
		let confFile;

		confFile = __dirname + '/../config/amqp_test.json';
		log.verbose('Intercom config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function(err) {
			if (err) cb(err);

			log.verbose('Intercom config: ' + JSON.stringify(require(confFile)));
			lUtils.instances.intercom = new Intercom(require(confFile));
			//intercom = lUtils.instances.intercom;
			lUtils.instances.intercom.on('ready', cb);
		});
	});

	async.series(tasks, done);
});*/
