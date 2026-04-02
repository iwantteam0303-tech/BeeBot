const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { exec } = require('child_process');

const CLIENT_ID = '1488720287523541152';
const GUILD_ID = '1458078510030786704';
const GITHUB_RAW_URL = 'https://gist.githubusercontent.com/iwantteam0303-tech/60149702255f4787681e810e9587ffd9/raw/BeeBot';

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// 진행 중인 유저를 기록하여 중복 명령어 방지
const activeUsers = new Set();

// ----------------------------------------------------
// 명령어 정의
// ----------------------------------------------------
const commands = [
    new SlashCommandBuilder().setName('업데이트').setDescription('깃허브에서 최신 코드를 가져와 봇을 재시작합니다.'),
    
    // 관리자 명령어
    new SlashCommandBuilder().setName('할당').setDescription('디스코드 유저에게 식별이름을 할당합니다.')
        .addUserOption(opt => opt.setName('멘션').setDescription('대상 디스코드 유저').setRequired(true))
        .addStringOption(opt => opt.setName('유저네임').setDescription('할당할 로블록스 유저네임(식별이름)').setRequired(true)),
    new SlashCommandBuilder().setName('재시작').setDescription('특정 계정 또는 전체(All) 크롬 브라우저를 재시작합니다.')
        .addStringOption(opt => opt.setName('대상').setDescription('계정이름 또는 All').setRequired(true)),

    // 인게임 LBC 명령어
    new SlashCommandBuilder().setName('재접').setDescription('현재 할당된 계정을 게임 내에서 재접속시킵니다.'),
    new SlashCommandBuilder().setName('벌집').setDescription('현재 할당된 계정의 벌집 데이터를 가져옵니다.'),
    new SlashCommandBuilder().setName('뽑기').setDescription('조건에 맞춰 뽑기를 진행합니다.')
        .addStringOption(opt => opt.setName('con').setDescription('대상 셀 (예: 1,1 또는 All 등)').setRequired(true))
        .addStringOption(opt => opt.setName('mythic').setDescription('신화 벌 조건 (true/false)').setRequired(true))
        .addStringOption(opt => opt.setName('gifted').setDescription('기프티드 벌 조건 (true/false)').setRequired(true))
        .addStringOption(opt => opt.setName('names').setDescription('벌 이름 조건 (쉼표로 구분)').setRequired(true))
        .addStringOption(opt => opt.setName('restocks').setDescription('리스톡 사용 조건').setRequired(true)),
    
    // 미구현 명령어들
    new SlashCommandBuilder().setName('구미').setDescription('아직 기능이 추가되지 않은 명령어입니다.'),
    new SlashCommandBuilder().setName('일반먹이').setDescription('아직 기능이 추가되지 않은 명령어입니다.'),
    new SlashCommandBuilder().setName('꿀').setDescription('아직 기능이 추가되지 않은 명령어입니다.'),
    new SlashCommandBuilder().setName('구매').setDescription('아직 기능이 추가되지 않은 명령어입니다.'),
    new SlashCommandBuilder().setName('먹이').setDescription('아직 기능이 추가되지 않은 명령어입니다.'),
    new SlashCommandBuilder().setName('뽑기설정').setDescription('아직 기능이 추가되지 않은 명령어입니다.'),
    new SlashCommandBuilder().setName('몹스폰시간').setDescription('아직 기능이 추가되지 않은 명령어입니다.'),
    new SlashCommandBuilder().setName('퀘스트보기').setDescription('아직 기능이 추가되지 않은 명령어입니다.'),
    new SlashCommandBuilder().setName('스탯').setDescription('아직 기능이 추가되지 않은 명령어입니다.')
].map(command => command.toJSON());

// ----------------------------------------------------
// 유틸리티 함수들
// ----------------------------------------------------

// LBC 파일 상태 체크 함수
function checkLbcStatus(filePath, attempt, maxAttempts, resolve, reject) {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return reject('상태를 확인하는 중 파일을 읽을 수 없게 되었습니다.');

        const parsed = JSON.parse(data);

        // 성공적으로 값을 반환받은 경우
        if (parsed.status === 'return') {
            return resolve(parsed.content);
        }

        // 응답이 오지 않았으나 대기 횟수가 남은 경우
        if (attempt < maxAttempts) {
            setTimeout(() => {
                checkLbcStatus(filePath, attempt + 1, maxAttempts, resolve, reject);
            }, 5000);
        } else {
            // 최대 대기 횟수를 초과한 경우
            reject('응답없음: 지정된 시간 내에 외부 프로그램의 응답이 없습니다.');
        }
    });
}

// 공통 LBC 요청 함수 (maxAttempts: 대기 횟수, 1회당 5초)
function sendLbcRequest(username, commandName, options = {}, maxAttempts = 2) {
    return new Promise((resolve, reject) => {
        fs.readFile('settings.json', 'utf8', (err, data) => {
            if (err) return reject('settings.json 파일을 읽을 수 없습니다.');
            
            const settings = JSON.parse(data);
            if (!settings.workspace) return reject('settings.json에 workspace 경로가 없습니다.');

            const filePath = path.join(settings.workspace, `info_${username}.lbc`);

            // 기존에 해당 파일이 있는지 먼저 검사
            fs.access(filePath, fs.constants.F_OK, (accessErr) => {
                if (accessErr) return reject(`파일을 찾을 수 없습니다. (경로: ${filePath})`);

                const requestContent = {
                    Command: commandName,
                    ...options
                };

                const writeData = JSON.stringify({
                    status: "request",
                    content: requestContent
                }, null, 2);

                fs.writeFile(filePath, writeData, 'utf8', (writeErr) => {
                    if (writeErr) return reject('요청 파일을 쓰는 중 오류가 발생했습니다.');

                    // 작성 성공 시 5초 후 첫 번째 체크 시작
                    setTimeout(() => {
                        checkLbcStatus(filePath, 1, maxAttempts, resolve, reject);
                    }, 5000);
                });
            });
        });
    });
}

// 디스코드 유저 ID로 할당된 식별이름 가져오기
function getAssignedUsername(discordId) {
    return new Promise((resolve, reject) => {
        fs.readFile('Users.json', 'utf8', (err, data) => {
            if (err) return reject('할당된 계정이 없습니다.'); 
            
            const users = JSON.parse(data);
            if (users[discordId]) {
                resolve(users[discordId]);
            } else {
                reject('할당된 계정이 없습니다.');
            }
        });
    });
}

// ----------------------------------------------------
// 봇 초기화 및 로그인 (🔥 정규식 적용으로 토큰 에러 방지 🔥)
// ----------------------------------------------------
fs.readFile('token.txt', 'utf8', (err, data) => {
    if (err) {
        console.error('token.txt 파일을 읽을 수 없습니다.');
        return;
    }
    
    // 보이지 않는 유령 문자, 띄어쓰기, 줄바꿈을 완벽하게 제거
    const TOKEN = data.replace(/[^a-zA-Z0-9_.-]/g, '');
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
        .then(() => console.log('슬래시 명령어 등록 완료'))
        .catch(console.error);

    client.login(TOKEN).catch(console.error);
});

client.on('ready', () => {
    console.log(`${client.user.tag} 구동 준비 완료.`);
});

// ----------------------------------------------------
// 명령어 처리부
// ----------------------------------------------------
client.on('interactionCreate', (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;

    // 미구현 명령어 처리
    const notImplemented = ['구미', '일반먹이', '꿀', '구매', '먹이', '뽑기설정', '몹스폰시간', '퀘스트보기', '스탯'];
    if (notImplemented.includes(cmd)) {
        return interaction.reply({ content: '지금은 아직 기능이 추가되지 않은 명령어입니다.', ephemeral: true });
    }

    // 1. 할당 명령어 (Users.json 생성/수정)
    if (cmd === '할당') {
        const targetUser = interaction.options.getUser('멘션');
        const username = interaction.options.getString('유저네임');

        fs.readFile('Users.json', 'utf8', (err, data) => {
            let users = {};
            if (!err && data) {
                users = JSON.parse(data);
            }
            users[targetUser.id] = username;
            
            fs.writeFile('Users.json', JSON.stringify(users, null, 2), 'utf8', (writeErr) => {
                if (writeErr) return interaction.reply({ content: '할당 저장 중 오류가 발생했습니다.', ephemeral: true });
                
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setDescription(`<@${targetUser.id}> 님에게 로블록스 계정 \`${username}\`이(가) 할당되었습니다!`);
                interaction.reply({ embeds: [embed] });
            });
        });
        return;
    }

    // 2. 업데이트
    if (cmd === '업데이트') {
        interaction.reply('업데이트를 시작합니다...').then(() => {
            https.get(GITHUB_RAW_URL, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    fs.writeFile(__filename, data, (err) => {
                        if (err) return interaction.editReply('파일 덮어쓰기 실패.');
                        interaction.editReply('파일 업데이트 완료! 3초 후 재시작합니다.').then(() => {
                            setTimeout(() => { process.exit(0); }, 3000);
                        });
                    });
                });
            }).on('error', (e) => {
                interaction.editReply('깃허브 통신 실패: ' + e.message);
            });
        });
        return;
    }

    // 3. 재시작
    if (cmd === '재시작') {
        const target = interaction.options.getString('대상');
        
        fs.readFile('settings.json', 'utf8', (err, data) => {
            if (err) return interaction.reply({ content: 'settings.json 파일을 찾을 수 없습니다.', ephemeral: true });
            
            const settings = JSON.parse(data);
            if (!settings.vip_link) return interaction.reply({ content: 'settings.json에 vip_link 항목을 설정해 주세요!', ephemeral: true });
            
            const link = settings.vip_link;
            const accounts = settings.accounts;

            if (target.toLowerCase() === 'all') {
                const names = Object.keys(accounts);
                const delayMs = settings.delay || 2000;
                
                interaction.reply(`총 ${names.length}개의 계정을 재시작합니다.`).then(() => {
                    names.forEach((name, index) => {
                        const profile = accounts[name];
                        const commandStr = `start "" chrome --profile-directory="${profile}" "${link}"`;
                        setTimeout(() => {
                            exec(commandStr, (execErr) => {
                                if (execErr) console.error(`[${name}] 실행 오류:`, execErr.message);
                            });
                        }, index * delayMs);
                    });
                });
            } else {
                const profile = accounts[target];
                if (!profile) return interaction.reply({ content: `settings.json에서 '${target}' 계정을 찾을 수 없습니다.`, ephemeral: true });
                
                const commandStr = `start "" chrome --profile-directory="${profile}" "${link}"`;
                exec(commandStr, (execErr) => {
                    if (execErr) return interaction.reply(`실행 오류: ${execErr.message}`);
                    interaction.reply(`✅ '${target}' 계정 재접속 명령을 실행했습니다.`);
                });
            }
        });
        return;
    }

    // ====================================================
    // LBC 통신 명령어 (동시 실행 제한)
    // ====================================================
    if (activeUsers.has(interaction.user.id)) {
        return interaction.reply({ content: '⚠️ 이미 진행 중인 명령어가 있습니다. 이전 요청이 끝날 때까지 기다려 주세요.', ephemeral: true });
    }

    getAssignedUsername(interaction.user.id)
        .then(username => {
            activeUsers.add(interaction.user.id);
            interaction.reply({ content: '요청을 게임으로 전송 중입니다...' }).then(() => {
                
                // 4. 재접
                if (cmd === '재접') {
                    sendLbcRequest(username, 'Rejoin', {}, 2)
                        .then(content => {
                            const embed = new EmbedBuilder().setColor(0x0099FF).setTitle('재접속 요청 성공').setDescription('게임 서버 재접속을 시작합니다.');
                            interaction.editReply({ content: '', embeds: [embed] });
                            activeUsers.delete(interaction.user.id);
                        })
                        .catch(errMsg => {
                            interaction.editReply({ content: `❌ 오류: ${errMsg}` });
                            activeUsers.delete(interaction.user.id);
                        });
                }

                // 5. 벌집
                if (cmd === '벌집') {
                    sendLbcRequest(username, 'GetHive', {}, 2)
                        .then(content => {
                            const hiveData = content.HiveData;
                            let gridText = '';
                            
                            for (let y = 10; y >= 1; y--) {
                                let rowArr = [];
                                for (let x = 1; x <= 5; x++) {
                                    const targetCell = `${x},${y}`;
                                    const found = hiveData.find(c => c.Cell === targetCell);
                                    if (found) {
                                        rowArr.push(`${found.Name}(Lvl:${found.Level})`);
                                    } else {
                                        rowArr.push('Empty');
                                    }
                                }
                                gridText += rowArr.join(' | ') + '\n';
                            }

                            const embed = new EmbedBuilder()
                                .setColor(0xFFA500)
                                .setTitle(`🐝 ${username} 님의 벌집 상태`)
                                .setDescription(`\`\`\`\n${gridText}\n\`\`\``);
                                
                            interaction.editReply({ content: '', embeds: [embed] });
                            activeUsers.delete(interaction.user.id);
                        })
                        .catch(errMsg => {
                            interaction.editReply({ content: `❌ 오류: ${errMsg}` });
                            activeUsers.delete(interaction.user.id);
                        });
                }

                // 6. 뽑기
                if (cmd === '뽑기') {
                    const reqOptions = {
                        CON: interaction.options.getString('con'),
                        Mythic: interaction.options.getString('mythic'),
                        Gifted: interaction.options.getString('gifted'),
                        Names: interaction.options.getString('names'),
                        Restocks: interaction.options.getString('restocks')
                    };

                    sendLbcRequest(username, 'ReadyRoll', reqOptions, 2)
                        .then(content => {
                            const cells = content.Cells;

                            if (cells.length > 1) {
                                const embed = new EmbedBuilder()
                                    .setColor(0xFFFF00)
                                    .setTitle('해당하는 셀이 여러 개입니다. 어떤 걸 선택하시겠습니까?');
                                
                                const row = new ActionRowBuilder();
                                cells.forEach((cellData, idx) => {
                                    if (idx < 5) {
                                        row.addComponents(
                                            new ButtonBuilder()
                                                .setCustomId(`sel_${cellData.Cell}`)
                                                .setLabel(`${cellData.Name}(${cellData.Cell}) : Lvl : ${cellData.Level}`)
                                                .setStyle(ButtonStyle.Secondary)
                                        );
                                    }
                                });

                                interaction.editReply({ content: '', embeds: [embed], components: [row] }).then(msg => {
                                    const filter = i => i.user.id === interaction.user.id;
                                    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

                                    collector.on('collect', i => {
                                        const chosenCell = i.customId.replace('sel_', '');
                                        reqOptions.CON = chosenCell; 
                                        i.deferUpdate().then(() => {
                                            collector.stop();
                                            executeSingleRoll(interaction, username, reqOptions, cells.find(c => c.Cell === chosenCell));
                                        });
                                    });

                                    collector.on('end', collected => {
                                        if (collected.size === 0) {
                                            interaction.editReply({ content: '입력 시간이 초과되었습니다.', components: [] });
                                            activeUsers.delete(interaction.user.id);
                                        }
                                    });
                                });
                            } else {
                                executeSingleRoll(interaction, username, reqOptions, cells[0]);
                            }
                        })
                        .catch(errMsg => {
                            interaction.editReply({ content: `❌ 오류: ${errMsg}` });
                            activeUsers.delete(interaction.user.id);
                        });
                }
            });
        })
        .catch(err => {
            interaction.reply({ content: `<@${interaction.user.id}> 할당된 계정이 없습니다.`, ephemeral: true });
        });
});

// 단일 셀 뽑기 상호작용 함수
function executeSingleRoll(interaction, username, reqOptions, cellData) {
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎲 뽑기 준비 완료!')
        .addFields(
            { name: '셀 정보', value: `위치: ${cellData.Cell}\n이름: ${cellData.Name}\n레벨: ${cellData.Level}`, inline: false },
            { name: '정지 조건', value: `Mythic: ${reqOptions.Mythic}\nGifted: ${reqOptions.Gifted}`, inline: false }
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roll_start').setLabel('뽑기').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('roll_stop').setLabel('끝내기').setStyle(ButtonStyle.Danger)
    );

    interaction.editReply({ content: '', embeds: [embed], components: [row] }).then(msg => {
        const filter = i => i.user.id === interaction.user.id;
        const collector = msg.createMessageComponentCollector({ filter, time: 300000 }); 

        collector.on('collect', i => {
            if (i.customId === 'roll_stop') {
                i.deferUpdate().then(() => {
                    collector.stop('stopped');
                    interaction.editReply({ content: '뽑기를 종료했습니다.', components: [] });
                    activeUsers.delete(interaction.user.id);
                });
            } else if (i.customId === 'roll_start') {
                i.deferUpdate().then(() => {
                    row.components[0].setDisabled(true);
                    row.components[1].setDisabled(true);
                    interaction.editReply({ content: '뽑기 요청 중... 대기 횟수 8회(40초) 소요 가능', components: [row] }).then(() => {
                        sendLbcRequest(username, 'Roll', reqOptions, 8)
                            .then(content => {
                                const newCellData = content.Cells[0] || content.Cells;
                                collector.stop('rerolled');
                                executeSingleRoll(interaction, username, reqOptions, newCellData);
                            })
                            .catch(errMsg => {
                                collector.stop('error');
                                interaction.editReply({ content: `❌ 뽑기 오류: ${errMsg}`, components: [] });
                                activeUsers.delete(interaction.user.id);
                            });
                    });
                });
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                interaction.editReply({ content: '시간 초과로 뽑기 모드를 종료합니다.', components: [] });
                activeUsers.delete(interaction.user.id);
            }
        });
    });
}
