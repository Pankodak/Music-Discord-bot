const Discord = require("discord.js");
const { prefix, token } = require("./config.json");
const ytdl = require("ytdl-core");
const ytpl = require("ytpl");
const axios = require("axios");

const client = new Discord.Client();

let queue = new Map();
let openFmMusicStations;
let musicGroups;
let musicStations;
client.on("ready", () => {
    client.user.setPresence({
        activity: { name: "Szczur pozostanie szczurem" },
        status: "online",
    });
    console.log("Ready!");
    axios
        .get("https://open.fm/api/static/stations/stations_new.json")
        .then(async (response) => {
            const musicStringList = [];
            musicGroups = response.data.groups;
            musicStations = response.data.channels;
            let buff = "";
            for (const musicChannel of musicStations) {
                const musicString = `${musicChannel.name}, ${getGroupNameFromId(
                    musicChannel.group_id
                )}, (${musicChannel.mnt})\n`;
                if (buff.length + musicString.length > 1024) {
                    musicStringList.push(buff);
                    buff = "";
                }
                buff += musicString;
            }
            musicStringList.push(buff);
            openFmMusicStations = musicStringList;
        })
        .catch((error) => console.log(error));
});
client.on("reconnecting", () => {
    console.log("Reconnecting!");
});
client.on("disconnect", () => {
    console.log("Disconnect!");
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    if (!(oldState.member.id == client.user.id)) return;
    if (!newState.channel) return queue.delete(oldState.member.guildId);
    let serverQueue = queue.get(oldState.guild.id);
    if (!serverQueue) {
        await join(newState.channel, serverQueue, oldState.guild.id);
        serverQueue = queue.get(oldState.guild.id);
    }
    if (serverQueue.voiceChannel.id != newState.channel.id) {
        serverQueue.voiceChannel = newState.channel;
    }
});

client.on("message", async (message) => {
    if (message.channel.type == "dm") return;
    if (message.author.bot) return;
    const channel = message.member.voice.channel;
    const messageArray = message.content.split(" ");
    const cmd = messageArray[0];
    const args = messageArray.slice(1);
    const guildId = message.guild.id;
    let serverQueue = queue.get(guildId);
    if (cmd == `${prefix}listopenfm`) {
        if (!openFmMusicStations) return;
        return listOpenFm(message);
    }
    if (cmd == `biesiada`) {
        if (!serverQueue) {
            await join(channel, serverQueue, guildId);
            serverQueue = queue.get(guildId);
        }
        if (!(channel.id == serverQueue?.voiceChannel.id)) return;
        return execute(serverQueue, 59, message);
    }
    if (!cmd.startsWith(prefix)) return;
    if (cmd == `${prefix}listopenfmgroups`) return listGroupsOpenFm(message);
    if (cmd == `${prefix}getstationinfo`)
        return getOpenFmStationInfo(message, args[0]);
    if (!channel) return;
    if (cmd == `${prefix}join`) return join(channel, serverQueue, guildId);
    if (cmd == `${prefix}play`) {
        if (!serverQueue) {
            await join(channel, serverQueue, guildId);
            serverQueue = queue.get(guildId);
        }
        if (!(channel.id == serverQueue?.voiceChannel.id)) return;
        return execute(serverQueue, args[0], message);
    }
    if (cmd == `${prefix}playlist`) {
        if (!serverQueue) {
            await join(channel, serverQueue, guildId);
            serverQueue = queue.get(guildId);
        }
        if (!(channel.id == serverQueue?.voiceChannel.id)) return;
        return playlist(serverQueue, args[0], message);
    }
    if (cmd == `${prefix}restart`) return restart();
    if (cmd == `${prefix}skip`) {
        if (!(channel.id == serverQueue?.voiceChannel.id)) return;
        return skip(message, serverQueue);
    }
    if (cmd == `${prefix}stop`) {
        if (!(channel.id == serverQueue?.voiceChannel.id)) return;
        return stop(message, serverQueue);
    }
    if (cmd == `${prefix}resume`) {
        if (!(channel.id == serverQueue?.voiceChannel.id)) return;
        return resume(message, serverQueue);
    }
    if (cmd == `${prefix}loop`) {
        if (!(channel.id == serverQueue?.voiceChannel.id)) return;
        serverQueue.isLoop = !serverQueue.isLoop;
        return message.channel.send(`Loop: ${serverQueue.isLoop}`);
    }
    if (cmd == `${prefix}volume`) {
        if (!(channel.id == serverQueue?.voiceChannel.id)) return;
        message.channel.send(`Volume: ${args[0] > 100 ? 100 : args[0]}`);
        return changeVolume(args[0], serverQueue);
    }
    if (cmd == `${prefix}listqueue`) return listQueue(serverQueue, message);

    if (cmd == `${prefix}fuckoff`) {
        if (!(channel.id == serverQueue?.voiceChannel.id)) return;
        serverQueue?.voiceChannel.leave();
        return queue.delete(guildId);
    }
});

const join = async (voiceChannel, serverQueue, guildId) => {
    if (!serverQueue) {
        const queueContruct = {
            voiceChannel: voiceChannel,
            connection: null,
            isOpenFm: true,
            songs: 2, // station number
            volume: 0.01,
            guildId: guildId,
            isLoop: false,
        };
        queue.set(guildId, queueContruct);
        try {
            const connection = await voiceChannel.join();
            queueContruct.connection = connection;
            return;
        } catch (err) {
            console.log(err);
            queue.delete(guildId);
            return;
        }
    }
};

const playlist = async (serverQueue, url, message) => {
    ytpl(url)
        .then(async (playlist) => {
            if (serverQueue.isOpenFm) {
                serverQueue.isOpenFm = false;
                serverQueue.songs = [];
            }
            const isCurrentlyPlaying = serverQueue.songs.length > 0;
            for (song of playlist.items) {
                const songInfo = {
                    title: song.title,
                    url: song.shortUrl,
                    duration: song.duration,
                };
                serverQueue.songs.push(songInfo);
            }
            await message.channel.send(
                `Added ${playlist.items.length} to queue`
            );
            if (!isCurrentlyPlaying) play(serverQueue, serverQueue.songs[0]);
        })
        .catch((err) => console.log(err));
};

const execute = async (serverQueue, url, message) => {
    if (isNum(url)) {
        if (!serverQueue.isOpenFm) {
            serverQueue.isOpenFm = true;
            serverQueue.songs = url;
        }
        await message.channel.send(`Stacja ${getStationNameFromId(url)}`);
        await getOpenFmStationInfo(message, url);
        return play(serverQueue, `http://stream.open.fm/${url}`);
    }
    if (serverQueue.isOpenFm) {
        serverQueue.isOpenFm = false;
        serverQueue.songs = [];
    }
    await pushSongToServerQueue(url, serverQueue);
    if (serverQueue.songs.length == 1) {
        play(serverQueue, serverQueue.songs[0]);
    }
};

const play = async (serverQueue, url) => {
    if (!url) {
        serverQueue.voiceChannel.leave();
        return queue.delete(serverQueue.guildId);
    }
    try {
        serverQueue.dispatcher = serverQueue.connection
            .play(serverQueue.isOpenFm ? url : ytdl(url.url))
            .on("error", (error) => console.error(error))
            .on("finish", () => {
                if (!serverQueue.isOpenFm) {
                    if (serverQueue.isLoop)
                        serverQueue.songs.push(serverQueue.songs[0]);
                    serverQueue.songs.shift();
                }
                const song = serverQueue.isOpenFm
                    ? serverQueue.songs
                    : serverQueue.songs[0];
                setTimeout(() => play(serverQueue, song), 1000);
            });
        serverQueue.dispatcher.setVolume(serverQueue.volume);
    } catch (error) {
        restart();
    }
};

const restart = async () => {
    await queue.forEach(async (value, key) => {
        await value.voiceChannel.leave();
        queue.delete(key);
        //     if (isNum(url)) {
        //   if (!serverQueue.isOpenFm) {
        //     serverQueue.isOpenFm = true;
        //     serverQueue.songs = url;
        //   }
        //   await message.channel.send(`Stacja ${getStationNameFromId(url)}`);
        //   await getOpenFmStationInfo(message, url);
        //   return play(serverQueue, `http://stream.open.fm/${url}`);
        // }
        // if (serverQueue.isOpenFm) {
        //   serverQueue.isOpenFm = false;
        //   serverQueue.songs = [];
        // }
    });
};

const skip = (message, serverQueue) => {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );
    if (serverQueue.songs.length == 0)
        return message.channel.send("There is no song that I could skip!");
    if (serverQueue.songs instanceof Array)
        return serverQueue.connection.dispatcher.end();
    return message.channel.send("Can't skip openFm radio, u idiot!");
};

const stop = (message, serverQueue) => {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );

    if (!serverQueue)
        return message.channel.send("There is no song that I could stop!");
    if (serverQueue.songs instanceof Array)
        return serverQueue.connection.dispatcher.pause(true);

    return message.channel.send("Can't skip openFm radio, u idiot!");
};
const resume = (message, serverQueue) => {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );

    if (!serverQueue)
        return message.channel.send("There is no song that I could stop!");

    if (serverQueue.songs instanceof Array)
        serverQueue.connection.dispatcher.resume();
};

const getOpenFmStationInfo = async (message, stationId) => {
    axios
        .get("https://open.fm/radio/api/v4/playlists/all.json?number=8")
        .then(async (response) => {
            const embed = new Discord.MessageEmbed()
                .setTitle(`OpenFM`)
                .setFooter(`Kox`, client.user.displayAvatarURL())
                .setTimestamp();
            for (const musicChannel of response.data) {
                if (musicChannel.stream_id == stationId) {
                    let buff = "";
                    for (const track of musicChannel.tracks) {
                        buff += `${track.song.artist}, ${track.song.title}\n`;
                    }
                    embed.addField(`Info o stacji numer ${stationId}`, buff);
                    await message.reply(embed);
                }
            }
        })
        .catch((error) => console.log(error));
};

const listOpenFm = async (message) => {
    const embed = new Discord.MessageEmbed()
        .setTitle(`OpenFM`)
        .setFooter(`Kox`, client.user.displayAvatarURL())
        .setTimestamp();
    for (let i = 0; i < openFmMusicStations.length; i++) {
        embed.addField(
            `Lista ${i + 1}/${openFmMusicStations.length}`,
            openFmMusicStations[i]
        );
        await message.channel.send(embed);
    }
};

const listGroupsOpenFm = async (message) => {
    let buff = "";
    const musicStringList = [];
    for (const group of musicGroups) {
        const musicString = `${group.name}\n`;
        if (buff.length + musicString.length > 1024) {
            musicStringList.push(buff);
            buff = "";
        }
        buff += musicString;
    }
    musicStringList.push(buff);
    for (let i = 0; i < musicStringList.length; i++) {
        const embed = new Discord.MessageEmbed()
            .setTitle(`OpenFM`)
            .setFooter(`Kox`, client.user.displayAvatarURL())
            .setTimestamp();
        embed.addField(
            `Lista ${i + 1}/${musicStringList.length}`,
            musicStringList[i]
        );
        await message.channel.send(embed);
    }
};
const listQueue = async (serverQueue, message) => {
    if (serverQueue.isOpenFm)
        return message.channel.send("Are u stupid or stupid?");

    let buff = "";
    const musicStringList = [];
    for (const song of serverQueue.songs) {
        const musicString = `${song.title}, ${song.duration} \n`;
        if (buff.length + musicString.length > 1024) {
            musicStringList.push(buff);
            buff = "";
        }
        buff += musicString;
    }
    musicStringList.push(buff);
    for (let i = 0; i < musicStringList.length; i++) {
        const embed = new Discord.MessageEmbed()
            .setTitle(`Youtube`)
            .setFooter(`Kox`, client.user.displayAvatarURL())
            .setTimestamp();
        embed.addField(
            `Lista ${i + 1}/${musicStringList.length}`,
            musicStringList[i]
        );
        await message.channel.send(embed);
    }
};

const pushSongToServerQueue = async (url, serverQueue) => {
    ytdl.getInfo(url)
        .then((songInfo) => {
            const duration = `${parseInt(
                songInfo.videoDetails.lengthSeconds / 60
            )}:${songInfo.videoDetails.lengthSeconds % 60}`;
            const song = {
                title: songInfo.videoDetails.title,
                url: songInfo.videoDetails.video_url,
                duration: duration,
            };
            serverQueue.songs.push(song);
        })
        .catch((err) => {
            console.error(err);
        });
};
const changeVolume = (value, serverQueue) => {
    if (value > 100) value = 100;
    serverQueue.volume = value / 100;
    serverQueue.dispatcher.setVolume(serverQueue.volume);
};

const getGroupNameFromId = (id) =>
    musicGroups.find((musicGroup) => musicGroup.id == id).name;
const getStationNameFromId = (id) =>
    musicStations.find((musicStation) => musicStation.id == id)?.name;

const isNum = (value) => /^\d+$/.test(value);

client.login(token);
