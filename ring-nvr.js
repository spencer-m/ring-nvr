const ringApi = require("ring-client-api");
const inquirer = require("inquirer");
const path = require("path");
const fetch = require('isomorphic-fetch');
const fs = require("fs");
var d = require("dropbox").Dropbox;
const VERSION = "1.00";

var VIDEO_LIST_SESSION_LOCAL = [];
const VIDEO_LIST_SESSION_LOCAL_MAX = 60;
var VIDEO_LIST_SESSION_DROPBOX = [];
const VIDEO_LIST_SESSION_DROPBOX_MAX = 60;

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
    console.log("[APP] Starting Ring Daemon version " + VERSION);
    const ring = new ringApi.RingApi({
        email: email,
        password: password,
        cameraDingsPollingSeconds: 5
    });
    const db = new d({
        fetch: fetch, accessToken: accessToken
    });

    ring.getCameras().then(result => {
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
        }
        else {
            Promise.reject(doorbellName + " camera not found");
        }
    });
}

async function record(camera, dropbox, kindstr) {
    let recordingname = getNow() + "-" + kindstr;
    let videoname = recordingname + "-%d.mp4"
    console.log("[APP: " + recordingname + "] Starting recording...")
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
        console.log("[APP: " + recordingname + "] Recording has ended.");
        dropboxUploadRecording(dropbox, recordingname);
        VIDEO_LIST_SESSION_LOCAL.push(recordingname);
        VIDEO_LIST_SESSION_DROPBOX.push(recordingname);
        maintainLocal();
        maintainDropbox(dropbox);
    });
    setTimeout(() => {
        console.log("[APP: " + recordingname + "] Stopping recording...");
        sipSession.stop();
    }, 63 * 1000);
}

function getNow() {
    const now = new Date();
    return now.getFullYear() + "-"
            + (now.getMonth()+1) + "-"
            + now.getDate() + "T"
            + now.getHours() + ""
            + now.getMinutes() + ""
            + now.getSeconds();
}

function dropboxUploadRecording(db, recordingname) {

    console.log("[DROPBOX] Uploading " + recordingname);
    for (let i = 0; i < 6; i++) {
        let fname = recordingname + "-" + i + ".mp4";
        fs.readFile(path.join("recordings", fname), function(err, data) {
            db.filesUpload({
                contents: data,
                path: "/recordings/" + fname
            })
            .then(function() {
                console.log("[DROPBOX] Successfully uploaded " + fname);
            })
            .catch(function(error) {
                console.log("[DROPBOX] Upload failed for  " + fname);
                console.log(error);
            });
        });
    }   
}

function dropboxDeleteRecording(db, recordingname) {

    console.log("[DROPBOX] Deleting " + recordingname);
    for (let i = 0; i < 6; i++) {
        let fname = recordingname + "-" + i + ".mp4";
        db.filesDelete({
            path: "/recordings/" + fname
        }).then(function() {
            console.log("[DROPBOX] Successfully deleted " + fname);
        })
        .catch(function(error) {
            console.log("[DROPBOX] Delete failed for " + fname);
            console.log(error);
        });
    } 
}

function maintainDropbox(db) {

    if (VIDEO_LIST_SESSION_DROPBOX.length > VIDEO_LIST_SESSION_DROPBOX_MAX) {
        recordingname = VIDEO_LIST_SESSION_DROPBOX.shift();
        console.log("[DROPBOX] Deleting recording " + recordingname);
        dropboxDeleteRecording(db, recordingname);
    }
}

function maintainLocal() {

    if  (VIDEO_LIST_SESSION_LOCAL.length > VIDEO_LIST_SESSION_LOCAL_MAX) {
        recordingname = VIDEO_LIST_SESSION_LOCAL.shift();
        for (let i = 0; i <= 6; i++) {
            let fname = recordingname + "-" + i + ".mp4";
            fs.unlink(path.join("recordings", fname), function(err) {
                if (err) {
                    console.log(err);
                }
                console.log("[LOCAL] Deleted recording " + fname);
            });
        }
    }
}

login();