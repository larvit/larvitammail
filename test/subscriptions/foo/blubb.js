'use strict';

exports = module.exports = function (params, cb) {
	cb(null, {to: 'foo@blubb.org', templateData: {username: 'Bosse'}});
};
