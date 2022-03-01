[![Build Status](https://github.com/larvit/larvitammail/actions/workflows/actions.yml/badge.svg)](https://github.com/larvit/larvitammail/actions)

# larvitammail

Mailing framework for the Larvit AM project

Subscribing to exchanges in the RabbitMQ-network and by extensions and templates
sends emails depending on rules in the extensions.

## Usage

### Setup

```javascript
const Intercom = require('larvitamintercom'),
const AmMail = require('larvitammail'),
const Mail = require('larvitmail');

const amMail = new AmMail({
	intercom: new Intercom('amqp://user:password@192.168.0.1/'), // It is important this is a standalone intercom instance!
	mail: new Mail({
		transportConf: 'smtps://user%40gmail.com:pass@smtp.gmail.com',
		mailDefaults: {
			from: 'foo@bar.com'
		}
	}),
});

await amMail.registerSubscriptions();
// Up and running now!
```

#### Subscriptions

Now create a folder in your process.cwd() called "subscriptions".
In that directory you create another folder with the same name as your exchange in you subscriptions,
in this case "exampleExchange". Now create a file in that directory with the same as your action in that exchange, in this case "exampleAction.js"

And it should look something like this (subscriptions/exampleExchange/exampleAction.js):

```javascript
// The value "params" here is the object that was sent in the subscriptions message.
exports = module.exports = async params => {
	return {
		// Mandatory
		to: 'bar@foo.com',

		// Optional
		subject: 'The file you wanted', // Defaults to empty string
		from: 'from@someone.com', // Defaults to mail defaults from
		templateData: {'username': 'Lennart'}, // Defaults to empty object. This is the data that will be sent to the email template.
		notSend: true, // Will make this email not being sent
		template: 'subscriptions/exampleExchange/exampleAction.tmpl',	// Defaults to the same as this file, but tmpl instead of js as file ending

		// Attachments, attached files, optional
		attachments: [
			{
				filename: 'text.txt',
				content: new Buffer('hello world!', 'utf-8')
			}
		]
	};
};
```

#### Templates

As default to our above subscription, create a file in process.cwd(): subscriptions/exampleExchange/exampleAction.tmpl

The templating is done with lodash and it should look something like this:

```
Hi <%= obj.username %>!
Here is the file you requested.

Best regards
Mr. Smith
```

#### Result

Now will larvitammail listen to the exchange "exampleExchange" and as soon a message with the action "exampleAction" is received the mailer will look for the subscription in "subscriptions/exampleExchane/exampleAction.js" and will return data to proceed. Then it will fetch the template in "subscriptions/exampleExchane/exampleAction.tmpl" and send the email.
