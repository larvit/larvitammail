'use strict';

// Set current working directory so the linting is happening on the right path
process.chdir(__dirname + '/..');

require(
	'mocha-eslint')([__dirname + '/..'],
	{
		// Increase the timeout of the test if linting takes to long
		'timeout':	5000,	// Defaults to the global mocha `timeout` option

		// Increase the time until a test is marked as slow
		'slow':	1000,	// Defaults to the global mocha `slow` option
	}
);
