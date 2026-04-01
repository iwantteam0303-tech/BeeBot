const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');

// 네가 입력해 준 ID로 적용 완료!
const CLIENT_ID = '1488720287523541152';
const GUILD_ID = '1458078510030786704';
// Gist 고유 ID가 포함된 정상적인 주소
const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/iwantteam0303-tech/BeeBot/main/index.js';

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// 명령어 3개 정의 (업데이트, 재실행, 일괄재실행)
const commands = [
    new SlashCommandBuilder()
        .setName('업데이트')
        .setDescription('깃허브에서 최신 코드를 가져와 봇을 재시작합니다.'),
    new SlashCommandBuilder()
        .setName('재실행')
        .setDescription('특정 계정의 크롬 브라우저로 로블록스 링크를 실행합니다.')
        .addStringOption(option => 
            option.setName('이름')
            .setDescription('settings.json에 등록된 계정 이름 (예: 본캐)')
            .setRequired(true))
        .addStringOption(option => 
            option.setName('링크')
            .setDescription('로블록스 VIP 서버 링크')
            .setRequired(true)),
    new SlashCommandBuilder()
        .setName('일괄재실행')
        .setDescription('모든 계정의 크롬 브라우저로 로블록스 링크를 순차 실행합니다.')
        .addStringOption(option => 
            option.setName('링크')
            .setDescription('로블록스 VIP 서버 링크')
            .setRequired(true))
].map(command => command.toJSON());

// token.txt 파일을 읽어와서 봇 로그인 및 명령어 등록 진행
fs.readFile('token.txt', 'utf8', (err, data) => {
    if (err) {
        console.error('token.txt 파일을 읽는 중 오류가 발생했습니다. 파일이 폴더에 있는지 확인해 주세요.');
        return;
    }
    
    const TOKEN = data.trim();
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
        .then(() => console.log('슬래시 명령어 등록 완료'))
        .catch(console.error);

    client.login(TOKEN).catch(console.error);
});

client.on('ready', () => {
    console.log(`${client.user.tag} 봇이 준비되었습니다.`);
});

client.on('interactionCreate', (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // 1. 업데이트 명령어
    if (interaction.commandName === '업데이트') {
        interaction.reply('업데이트를 시작합니다. 잠시만 기다려 주세요...')
            .then(() => {
                https.get(GITHUB_RAW_URL, (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        fs.writeFile(__filename, data, (err) => {
                            if (err) {
                                interaction.editReply('파일 쓰기 중 오류가 발생했습니다.');
                                return;
                            }
                            interaction.editReply('파일 업데이트 성공! 봇을 재시작합니다.')
                                .then(() => {
                                    setTimeout(() => {
                                        process.exit(0);
                                    }, 3000);
                                });
                        });
                    });
                }).on('error', (e) => {
                    interaction.editReply('깃허브 연결 실패: ' + e.message);
                });
            });
    }

    // 2. 특정 계정 재실행 명령어
    if (interaction.commandName === '재실행') {
        const name = interaction.options.getString('이름');
        const link = interaction.options.getString('링크');

        fs.readFile('settings.json', 'utf8', (err, data) => {
            if (err) {
                return interaction.reply('settings.json 파일을 찾을 수 없어!');
            }
            
            const settings = JSON.parse(data);
            const accounts = settings.accounts;

            if (!accounts) {
                return interaction.reply('settings.json 안에 "accounts" 항목이 없어.');
            }

            const profile = accounts[name];

            if (!profile) {
                return interaction.reply(`'${name}' 계정을 settings.json에서 찾을 수 없어.`);
            }

            const command = `start "" chrome --profile-directory="${profile}" "${link}"`;

            exec(command, (execErr) => {
                if (execErr) {
                    return interaction.reply(`실행 중 오류 발생: ${execErr.message}`);
                }
                interaction.reply(`✅ '${name}' 계정(${profile})으로 크롬을 실행했어!`);
            });
        });
    }

    // 3. 일괄 재실행 명령어
    if (interaction.commandName === '일괄재실행') {
        const link = interaction.options.getString('링크');

        fs.readFile('settings.json', 'utf8', (err, data) => {
            if (err) {
                return interaction.reply('settings.json 파일을 찾을 수 없어!');
            }
            
            const settings = JSON.parse(data);
            const accounts = settings.accounts;

            if (!accounts) {
                return interaction.reply('settings.json 안에 "accounts" 항목이 없어.');
            }

            const delayMs = settings.delay || 2000;
            const names = Object.keys(accounts);

            if (names.length === 0) {
                return interaction.reply('settings.json의 accounts 항목에 등록된 계정이 없어.');
            }

            interaction.reply(`총 ${names.length}개의 계정에 대해 ${delayMs / 1000}초 간격으로 순차 접속을 시작할게!`).then(() => {
                names.forEach((name, index) => {
                    const profile = accounts[name];
                    const command = `start "" chrome --profile-directory="${profile}" "${link}"`;

                    setTimeout(() => {
                        exec(command, (execErr) => {
                            if (execErr) {
                                console.error(`[${name}] 실행 오류:`, execErr.message);
                            }
                        });
                    }, index * delayMs);
                });
            });
        });
    }
});
            .then(() => {
                // Gist에서 파일 읽어오기
                https.get(GITHUB_RAW_URL, (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        // 기존 파일을 새 코드로 덮어쓰기
                        fs.writeFile(__filename, data, (err) => {
                            if (err) {
                                interaction.editReply('파일 쓰기 중 오류가 발생했습니다.');
                                return;
                            }
                            interaction.editReply('파일 업데이트 성공! 봇을 재시작합니다.')
                                .then(() => {
                                    // 3초 후 봇 종료 -> 배치 파일에 의해 재시작됨
                                    setTimeout(() => {
                                        process.exit(0);
                                    }, 3000);
                                });
                        });
                    });
                }).on('error', (e) => {
                    interaction.editReply('깃허브 연결 실패: ' + e.message);
                });
            });
    }
});
