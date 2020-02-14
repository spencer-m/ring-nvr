const ringApi = require("ring-client-api");
const inquirer = require("inquirer");
const path = require("path");
const fetch = require("isomorphic-fetch");
const fs = require("fs");
var d = require("dropbox").Dropbox;
const fileLogger = require("log-to-file");
const VERSION = "2.00";

var VIDEO_LIST_SESSION_LOCAL = [];
const VIDEO_LIST_SESSION_LOCAL_MAX = 60;
var VIDEO_LIST_SESSION_DROPBOX = [];
const VIDEO_LIST_SESSION_DROPBOX_MAX = 60;

function logger() {
    let line = "";
    for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === "string" || arguments[i] instanceof String) {
            line = line.concat(arguments[i]);   
        }
        else {
            line = line.concat(JSON.stringify(arguments[i]));
        }
    }
    console.log(line);
    fileLogger(line);
}

async function login() {
    inquirer.prompt([
        {
            type: "input",
            message: "Enter email: ",
            name: "email"
        },
        {
            type: "password",
            message: "Enter password: ",
            name: "password"
        },
        {
            type: "password",
            message: "Enter Dropbox access token: ",
            name: "accessToken"
        }
    ]).then(creds => {
        start(creds["email"], creds["password"], creds["accessToken"]);
    });
}

function start(email, password, accessToken) {
    logger("[APP: " + getNow() + "] Starting Ring Daemon version " + VERSION);
    const ring = new ringApi.RingApi({
        email: email,
        password: password,
        cameraDingsPollingSeconds: 5,
        cameraStatusPollingSeconds: 50
    });
    const db = new d({
        fetch: fetch, accessToken: accessToken
    });
    db.filesListFolder({
        path: ""
    })
    .then(function() {
        logger("[DROPBOX] Login successful.");
    })
    .catch(function(err) {
        logger("[DROPBOX] Failed to login.");
        logger(err);
    });

    ring.getCameras().then(result => {
        
        // the name of your doorbell
        const doorbellName = "Front Door";
        
        let frontDoor = result.filter(camera => camera.name === doorbellName);
        if (frontDoor.length === 1) {
            frontDoor[0].onNewDing.subscribe(ding => {
                if (ding.kind === "motion") {
                    record(frontDoor[0], db, "motion");
                }
                else if (ding.kind === "ding") {
                    record(frontDoor[0], db, "ding");
                }
            });
            setInterval(function(doorbell) {
                doorbell.getHealth().then(result => {
                    logger("[APP: " + getNow() + "] Periodic Status Update.");    
                    logger("Battery Percentage: " + result.battery_percentage + " "  + result.battery_percentage_category);
                    logger("Signal Stength: " + result.latest_signal_strength + " " + result.latest_signal_category);
                });
            }, 60 * 60 * 1000, frontDoor[0]);
        }
        else {
            Promise.reject(doorbellName + " camera not found");
        }
    });
}

async function record(camera, dropbox, kindstr) {
    let recordingname = getNow() + "-" + kindstr;
    let videoname = recordingname + "-%d.mp4";
    logger("[APP: " + recordingname + "] Starting recording...");
    const sipSession = await camera.streamVideo({
        output: [
            "-flags",
            "+global_header",
            "-f",
            "segment",
            "-segment_time",
            "10",
            "-segment_format_options",
            "movflags=+faststart",
            "-reset_timestamps",
            "1",
            path.join("recordings", videoname)
        ]
    });
    sipSession.onCallEnded.subscribe(() => {
        logger("[APP: " + recordingname + "] Recording has ended.");
        dropboxUploadRecording(dropbox, recordingname);
        VIDEO_LIST_SESSION_LOCAL.push(recordingname);
        VIDEO_LIST_SESSION_DROPBOX.push(recordingname);
        maintainLocal();
        maintainDropbox(dropbox);
        writeRecordingsData();
    });
    setTimeout(() => {
        logger("[APP: " + recordingname + "] Stopping recording...");
        sipSession.stop();
    }, 63 * 1000);
}

function getNow() {
    const now = new Date();
    return now.getFullYear() + "-"
            + ("0" + (now.getMonth()+1)).slice(-2) + "-"
            + ("0" + now.getDate()).slice(-2) + "T"
            + ("0" + now.getHours()).slice(-2) + ""
            + ("0" + now.getMinutes()).slice(-2) + ""
            + ("0" + now.getSeconds()).slice(-2);
}

function dropboxUploadRecording(db, recordingname) {

    logger("[DROPBOX] Uploading " + recordingname);
    for (let i = 0; i < 6; i++) {
        let fname = recordingname + "-" + i + ".mp4";
        fs.readFile(path.join("recordings", fname), function(err, data) {
            dropboxFileUpload(db, data, fname);
        });
    }   
}

function dropboxFileUpload(db, data, fname) {
    db.filesUpload({
        contents: data,
        path: "/recordings/" + fname
    })
    .then(function() {
        logger("[DROPBOX] Successfully uploaded " + fname);
    })
    .catch(function(error) {
        logger("[DROPBOX] Upload failed for " + fname);
        logger(error);
        if (error.response.status === 429) {
            logger("[DROPBOX] Reattempt upload for " + fname);
            dropboxFileUpload(db, data, fname);
        }
    });
}

function dropboxDeleteRecording(db, recordingname) {
    logger("[DROPBOX] Deleting " + recordingname);
    for (let i = 0; i < 6; i++) {
        let fname = recordingname + "-" + i + ".mp4";
        dropboxFileDelete(db, fname);
    } 
}

function dropboxFileDelete(db, fname) {
    db.filesDelete({
        path: "/recordings/" + fname
    }).then(function() {
        logger("[DROPBOX] Successfully deleted " + fname);
    })
    .catch(function(error) {
        logger("[DROPBOX] Delete failed for " + fname);
        logger(error);
    });
}

function maintainDropbox(db) {
    if (VIDEO_LIST_SESSION_DROPBOX.length > VIDEO_LIST_SESSION_DROPBOX_MAX) {
        let recordingname = VIDEO_LIST_SESSION_DROPBOX.shift();
        logger("[DROPBOX] Deleting recording " + recordingname);
        dropboxDeleteRecording(db, recordingname);
    }
}

function maintainLocal() {
    if  (VIDEO_LIST_SESSION_LOCAL.length > VIDEO_LIST_SESSION_LOCAL_MAX) {
        let recordingname = VIDEO_LIST_SESSION_LOCAL.shift();
        for (let i = 0; i <= 6; i++) {
            let fname = recordingname + "-" + i + ".mp4";
            fs.unlink(path.join("recordings", fname), function(err) {
                if (err) {
                    logger(err);
                }
                logger("[LOCAL] Deleted recording " + fname);
            });
        }
    }
}

function readRecordingsData() {
    if (fs.existsSync(path.join("data", "recordingsList"))) {
        let recordingsFile = fs.readFileSync(path.join("data", "recordingsList"), "utf8");
        let recordingsList = recordingsFile.split("\n");
        for (let i = 0; i < recordingsList.length; i++) {
            if (recordingsList[i].length !== 0) {
                VIDEO_LIST_SESSION_LOCAL.push(recordingsList[i]);
                VIDEO_LIST_SESSION_DROPBOX.push(recordingsList[i]);
            }
        }
    }
    logger("List of recordings: " + VIDEO_LIST_SESSION_LOCAL);
}

function writeRecordingsData() {
    var recordingsData = fs.createWriteStream(path.join("data", "recordingsList"));
    recordingsData.on("error", function(err) {
        logger("Error on writing recordings data.\n" + err);
        logger("Data: " + VIDEO_LIST_SESSION_LOCAL);
    });
    for (let i = 0; i < VIDEO_LIST_SESSION_LOCAL.length; i++) {
        recordingsData.write(VIDEO_LIST_SESSION_LOCAL[i] + "\n");
    }
    recordingsData.end();
}

function createRequiredDirectories() {
    if (!fs.existsSync(path.join("recordings"))) {
        logger("[APP] Creating recordings folder");
        fs.mkdirSync(path.join("recordings"));
    }
    if (!fs.existsSync(path.join("data"))) {
        logger("[APP] Creating data folder");
        fs.mkdirSync(path.join("data"));
    }
}

createRequiredDirectories();
readRecordingsData();
login();