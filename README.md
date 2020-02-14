# ring-nvr
Use a ring doorbell as a network video recorder. Records when motion is detected or someone presses the doorbell button.

### Getting Started
Make sure to have Node.js installed on the computer to be used as a server for the application. Install ffmpeg so that it could handle the video streams. The command ffmpeg would need to be in the PATH. A Ring account is needed to access your camera. A Dropbox API key is needed to be able to upload to it.

### Installing
First, download or clone the repository.
Next, the dependencies have to be satisfied. This can be  done by running:
```
npm install ring-client-api --save
npm install inquirer --save
npm install isomorphic-fetch --save
npm install dropbox --save
npm install log-to-file --save
```

### Running the app
Run the following command:
```
node ring-nvr.js
```

### Credits
A big shoutout to all the hardwork done by a lot of developers to make this possible!
* @dgreif - https://github.com/dgreif/ring - the ring API that I used to make this app
* @SBoudrias - https://github.com/SBoudrias/Inquirer.js - the library for getting user input
* FT Labs - https://www.npmjs.com/package/isomorphic-fetch - needed by dropbox
* Dropbox - https://github.com/dropbox/dropbox-sdk-js - file operations on Dropbox