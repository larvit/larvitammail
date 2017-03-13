# larvitammail
Mailing framework for the Larvit AM project

Subscribing to exchanges in the RabbitMQ-network and by extensions and templates
sends emails depending on rules in the extensions.


## Usage

#### Setup
```javascript
const options = {
        subscriptions: {
          exampleExchange:	{
            actions: [
            "exampleAction"
            ]
          }
        },
        mailConfig: {
          transportConf: 'smtps://user%40gmail.com:pass@smtp.gmail.com',
          mailDefaults: {
          from: 'foo@bar.com'
        }
      },
      mailer = new Mailer(options);

mailer.start(function(err) {
	cb(err);
});
```


#### Extensions
Now create a folder in your process directory called "extension".
In that directory you create another folder with the same name as your exchange in you subscriptions,
in this case "exampleExchange". Now create a file in that directory with the same as your action in that exchange, in this case "exampleAction.js"

And it should look something like this.
```javascript
// The value "params" here is the object thats was sent in the subscriptions message.
function run(params, cb) {
  const returnData	= {},
  err = null;
  returnData.subject = 'The file you wanted';
  returnData.to = 'bar@foo.com';
  returnData.from = 'from@someone.com'; // This is optional, will send to maildefaults in your settings if undefined.
  returnData.templateData = { // This is the data that will be sent to the email template.
    username: 'Lennart'
  };
  returnData.attachments	= [ // Here you list attachments, optional.
    {
      filename:	'text.txt',
      content:	new Buffer('hello world!', 'utf-8')
    }
  ];
  cb(err, returnData);
};

exports.run = run;
```

#### Templates
Now create a folder in your process directory called "templates".
In that directory you create another folder with the same name as your exchange in you subscriptions,
in this case "exampleExchange". Now create a file in that directory with the same as your action in that exchange, in this case "exampleAction.tmpl"

The templating is done with lodash and it should look something like this.
```
Hi <%= obj.data.username %>!
Here is the file you requested.

Best regards
Mr. Smith
```

#### Result
Now will larvitammail listen to the exchange "exampleExchange" and as soon a message with the action "exampleAction" will be recieved the mailer will look for the extension in "extensions/exampleExchane/exampleAction.js" and will return data to proceed.
Then it will fetch the template in "templates/exampleExchane/exampleAction.tmpl" and send the email.


#### Do NOT send
If you for some reason don't want to send the mail just set returnData.notSend to true in your extension
```javascript
function run(params, cb) {
  const returnData	= {},
  err = null;
  returnData.notSend = true;
  cb(err, returnData);
};

exports.run = run;
```

#### Custom Template
If you need to have several templates for the same actions you can set a custom template.

```javascript
// The value "params" here is the object thats was sent in the subscriptions message.
function run(params, cb) {
  const returnData	= {},
  err = null;
  returnData.subject = 'Email with';
  returnData.to = 'bar@foo.com';
  returnData.template = 'exampleExchange/customTemplate.tmpl';
  cb(err, returnData);
};

exports.run = run;
```
