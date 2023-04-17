const router = require('express').Router()
var escape = require('escape-html')
const bodyParser = require('body-parser')
const crypto = require('crypto')
const mongoose = require("mongoose")
const phraseblacklist = require('phrase-blacklist')
const bcrypt = require('bcrypt')
const md5 = require('md5')
const fetch = require('node-fetch')

const other = require('../../../my_modules/other')
const recaptcha = require('../../../my_modules/captcha')
const email = require('../../../my_modules/email')
const accountAPI = require('../../../my_modules/accountapi')
const pfAPI = require('../../../my_modules/pfapi')

const ForumSettings = mongoose.model("ForumSettings")
const Accounts = mongoose.model("Accounts")

// parse application/json
router.use(bodyParser.urlencoded({ extended: true }));
router.use(bodyParser.json({limit: '5mb'}))

// 	/api/account/register
router.options('/')
router.post('/', async (req, res, next) => {
	try {
		let response = {success: false}

		//Check if user is already logged in.
		if(req.session.uid) throw "Can't create account while logged in"
		
		//Must complete google captcha first
		if(!await recaptcha.captchaV2(req.body['g-recaptcha-response'], (req.headers['x-forwarded-for'] || req.connection.remoteAddress))) 
			throw "Captcha failed"
	
		//Sanitization
		var _POST = req.body
		var keyvalues = {}
		if('username' in _POST){
			let username = req.body.username
			
			if(!(username.length >= 3 && username.length <= 15)) throw "Username must be 3-15 characters in length"
			
			if(!other.isAlphaNumeric_(username)) throw "Only letters, numbers, and underscore are allowed"

			let isClean = phraseblacklist.isClean(username.toLowerCase())
			if (typeof isClean === "string") throw `Your username contains a banned phrase: ${isClean}`
			
			let existingAccount = await accountAPI.fetchAccount(username)
			if(existingAccount) throw "Username is taken"
			
			//No early exit, so pass
			//No need to escape since its been sanitized, but better safe than sorry
			keyvalues.username = escape(username)
		} 
		else throw "Missing username"
		
		if('email' in _POST){
			req.body.email = req.body.email.toLowerCase()
			if(!other.ValidateEmail(req.body.email)) throw "Invalid email"
			keyvalues.email = escape(req.body.email)
			if(!email.isMajorEmailDomain(req.body.email)) throw "We only allow email addresses from major email providers, such as Gmail."
			if(await accountAPI.emailTaken(req.body.email)) throw "An account already exists with this email" 

			//Uses gravatar for pfp if one exists for their email
			let hashedEmail = md5(req.body.email)
			await fetch(`https://en.gravatar.com/${hashedEmail}.json`)
			.then(res => res.json())
			.then(res => {
				if(res !== "User not found") {
					keyvalues.profilepicture = "https://www.gravatar.com/avatar/" + hashedEmail
				}
			})
		} 
		else throw "Missing email"

		
		if('password' in _POST){
			let password = _POST.password
			
			let validatedPassword = accountAPI.ValidatePassword(password)
			if(validatedPassword !== true) throw validatedPassword
			
			//No need to sanitize password. It can be what ever they want!
			//No need to escape since their password wouldn't be displayed as html anywhere. It may also interfere with authentication
			keyvalues.password = await bcrypt.hash(password, 10)
		} 
		else throw "Missing password"

		if('confirmpassword' in _POST){
			if(_POST.password !== _POST.confirmpassword)
				throw "Password confirmation must be the same as password"
		} 
		else throw "Missing password confirmation"
		
		let currentDate = new Date()
		keyvalues.creationdate = currentDate

		//Creates verification session
		let hash = crypto.randomBytes(64).toString('hex');
		keyvalues.emailVerification = {
			token: hash,
			lastSent: new Date()
		}
		
		//No exit, so create account because sanitization passed
		let newAccount = await new Accounts(keyvalues)
		.save()

		req.session.uid = newAccount._id

		//Send email verification request via email
		var emailBody = 'Hello,\n\n' +
		`Someone has signed up for the account, ${keyvalues.username}(ID:${req.session.uid}) at ${process.env.FORUM_URL} using your email. To verify this address, please visit the link below. In doing so, you remove restriction from services such as posting to the forum and enable higher account security.\n\n` +
		`${process.env.FORUM_URL}/verify?token=${hash}\n\n` + 
		`This message was generated by ${process.env.FORUM_URL}.`
		
		email.SendBasicEmail(keyvalues.email, `${(await ForumSettings.findOne({type: "title"})).value} | Email Verification`, emailBody)
		.catch(err=>{
			//Handle the error, but allow account to remain created successfully
			console.error(`Issue when sending the email verification at register for @${req.session.uid} ${keyvalues.email}: `, err)
		})

		//Report successful account creation
		response.success = true
		res.json(response)

		//Logs their login event
		await pfAPI.TrackLogin(newAccount._id, (req.headers['x-forwarded-for'] || req.connection.remoteAddress))
	}
	catch(e){
		next(e)
	}
})

module.exports = router;