const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
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
    // 관리자 명령어
    new SlashCommandBuilder().setName('업데이트').setDescription('깃허브에서 최신 코드를 가져와 봇을 재시작합니다.'),
    new SlashCommandBuilder().setName('할당').setDescription('디스코드 유저에게 식별이름을 할당합니다.')
        .addUserOption(opt => opt.setName('멘션').setDescription('대상 디스코드 유저').setRequired(true))
        .addStringOption(opt => opt.setName('유저네임').setDescription('할당할 로블록스 유저네임(식별이름)').setRequired(true)),
    new SlashCommandBuilder().setName('재시작').setDescription('특정 계정 또는 전체(All) 크롬 브라우저를 재시작합니다.')
        .addStringOption(opt => opt.setName('대상').setDescription('계정이름 또는 All').setRequired(true))
        .addBooleanOption(opt => opt.setName('로블록스종료').setDescription('실행 전 로블록스 프로세스 강제 종료').setRequired(true))
        .addIntegerOption(opt => opt.setName('매크로대기').setDescription('매크로 실행 대기 시간(초)').setRequired(true)),
    new SlashCommandBuilder().setName('컴퓨터재시작').setDescription('컴퓨터를 즉시 재시작합니다. (관리자 전용)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // 인게임 LBC 명령어
    new SlashCommandBuilder().setName('재접').setDescription('현재 할당된 계정을 게임 내에서 재접속시킵니다.'),
    new SlashCommandBuilder().setName('벌집').setDescription('현재 할당된 계정의 벌집 데이터를 가져옵니다.'),
    new SlashCommandBuilder().setName('뽑기').setDescription('조건에 맞춰 뽑기를 진행합니다.')
        .addStringOption(opt => opt.setName('con').setDescription('대상 셀 (예: 1,1 또는 All 등)').setRequired(true))
        .addStringOption(opt => opt.setName('mythic').setDescription('신화 벌 조건 (true/false)').setRequired(true))
        .addStringOption(opt => opt.setName('gifted').setDescription('기프티드 벌 조건 (true/false)').setRequired(true))
        .addStringOption(opt => opt.setName('names').setDescription('벌 이름 조건 (쉼표로 구분)').setRequired(true))
        .addStringOption(opt => opt.setName('restocks').setDescription('리스톡 사용 조건').setRequired(true)),
    new SlashCommandBuilder().setName('구미').setDescription('지정한 위치에 구미 벌 젤리를 사용합니다.')
        .addStringOption(opt => opt.setName('con').setDescription('대상 셀 위치').setRequired(true)),
    new SlashCommandBuilder().setName('일반먹이').setDescription('일반 먹이를 사용합니다. (미완성)')
        .addStringOption(opt => opt.setName('con').setDescription('대상 셀 위치').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('수량').setRequired(true))
        .addStringOption(opt => opt.setName('restocks').setDescription('리스톡 조건').setRequired(true)),
    new SlashCommandBuilder().setName('구매').setDescription('아이템을 구매합니다.')
        .addStringOption(opt => opt.setName('itemname').setDescription('아이템 이름').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('구매 수량').setRequired(true)),
    new SlashCommandBuilder().setName('먹이').setDescription('특정 먹이를 사용합니다.')
        .addStringOption(opt => opt.setName('itemname').setDescription('먹이 이름').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('사용 수량').setRequired(true)),
    new SlashCommandBuilder().setName('스탯').setDescription('현재 스탯을 가져옵니다.'),
    new SlashCommandBuilder().setName('뽑기설정').setDescription('뽑기 설정을 확인합니다.'),
    new SlashCommandBuilder().setName('몹스폰시간').setDescription('몹 스폰 시간을 확인합니다.'),
    new SlashCommandBuilder().setName('퀘스트보기').setDescription('현재 퀘스트를 확인합니다.')
].map(command => command.toJSON());

// ----------------------------------------------------
// 유틸리티 함수들
// ----------------------------------------------------

// LBC 파일 상태 체크 함수 (Node.js의 비동기 I/O를 사용하여 Lock 발생 안 함)
function checkLbcStatus(filePath, attempt, maxAttempts, resolve, reject) {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return reject('상태를 확인하는 중 파일을 찾을 수 없습니다.');

        try {
            // Lua가 파일에 쓰는 도중 읽어서 JSON이 깨져있을 경우를 대비한 try-catch
            const parsed = JSON.parse(data);
            if (parsed.status === 'return') {
                return resolve(parsed.content);
            }
        } catch (e) {
            // 파싱 에러(작성 중)면 무시하고 대기 진행
        }

        if (attempt < maxAttempts) {
            setTimeout(() => {
                checkLbcStatus(filePath, attempt + 1, maxAttempts, resolve, reject);
            }, 5000);
        } else {
            reject('응답없음');
        }
    });
}

// 공통 LBC 요청 함수
function sendLbcRequest(username, commandName, options = {}, maxAttempts = 2) {
    return new Promise((resolve, reject) => {
        fs.readFile('settings.json', 'utf8', (err, data) => {
            if (err) return reject('settings.json 파일을 읽을 수 없습니다.');
            
            let settings;
            try { settings = JSON.parse(data); } catch(e) { return reject('settings.json 문법 오류'); }
            if (!settings.workspace) return reject('settings.json에 workspace 경로가 없습니다.');

            const filePath = path.join(settings.workspace, `info_${username}.lbc`);

            const writeData = JSON.stringify({
                status: "request",
                content: { Command: commandName, ...options }
            }, null, 2);

            // 파일 덮어쓰기 (비동기라 즉시 닫힘)
            fs.writeFile(filePath, writeData, 'utf8', (writeErr) => {
                if (writeErr) return reject('요청 파일을 쓰는 중 오류가 발생했습니다.');

                setTimeout(() => {
                    checkLbcStatus(filePath, 1, maxAttempts, resolve, reject);
                }, 5000);
            });
        });
    });
}

// 디스코드 유저 ID로 할당된 식별이름 가져오기
function getAssignedUsername(discordId) {
    return new Promise((resolve, reject) => {
        fs.readFile('Users.json', 'utf8', (err, data) => {
            if (err) return reject(); 
            try {
                const users = JSON.parse(data);
                if (users[discordId]) resolve(users[discordId]);
                else reject();
            } catch (e) {
                reject();
            }
        });
    });
}

// 단순 Message 출력 처리 함수
function handleSimpleMessage(interaction, username, commandName, options = {}) {
    sendLbcRequest(username, commandName, options)
        .then(content => {
            const msg = content.Message || JSON.stringify(content);
            interaction.editReply({ content: msg });
            activeUsers.delete(interaction.user.id);
        })
        .catch(errMsg => {
            interaction.editReply({ content: errMsg });
            activeUsers.delete(interaction.user.id);
        });
}

// 단일 셀 뽑기 UI 및 로직 함수
function executeSingleRoll(interaction, username, reqOptions, cellData) {
    const contentText = `**셀 위치:** ${cellData.Cell}\n**이름:** ${cellData.Name}\n**레벨:** ${cellData.Level}\n\n**[정지 조건]**\nMythic: ${reqOptions.Mythic}\nGifted: ${reqOptions.Gifted}`;
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('뽑기!')
        .setDescription(contentText);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roll_start').setLabel('뽑기').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('roll_stop').setLabel('끝내기').setStyle(ButtonStyle.Danger)
    );

    interaction.editReply({ content: '', embeds: [embed], components: [row] }).then(msg => {
        const filter = i => i.user.id === interaction.user.id;
        const collector = msg.createMessageComponentCollector({ filter, time: 300000 }); 

        collector.on('collect', i => {
            if (i.customId === 'roll_stop') {
                i.deferUpdate().then(() => {
                    collector.stop('stopped');
                    embed.setTitle('뽑기가 종료되었습니다.');
                    interaction.editReply({ embeds: [embed], components: [] });
                    activeUsers.delete(interaction.user.id);
                });
            } else if (i.customId === 'roll_start') {
                i.deferUpdate().then(() => {
                    row.components[0].setDisabled(true);
                    row.components[1].setDisabled(true);
                    interaction.editReply({ components: [row] }).then(() => {
                        // 뽑기는 대기 횟수 8회
                        sendLbcRequest(username, 'Roll', { CON: reqOptions.CON }, 8)
                            .then(content => {
                                const newCellData = Array.isArray(content.Cells) ? content.Cells[0] : content.Cells;
                                collector.stop('rerolled');
                                executeSingleRoll(interaction, username, reqOptions, newCellData);
                            })
                            .catch(errMsg => {
                                collector.stop('error');
                                interaction.editReply({ content: errMsg, components: [] });
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

// ----------------------------------------------------
// 봇 초기화 및 로그인
// ----------------------------------------------------
fs.readFile('token.txt', 'utf8', (err, data) => {
    if (err) {
        console.error('token.txt 파일을 읽을 수 없습니다.');
        return;
    }
    
    const TOKEN = data.replace(/[^a-zA-Z0-9_.-]/g, '');
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
        .then(() => console.log('슬래시 명령어 등록 완료'))
        .catch(console.error);

    client.login(TOKEN).catch(console.error);
});

client.on('clientReady', () => {
    console.log(`${client.user.tag} 구동 준비 완료.`);
});

// ----------------------------------------------------
// 명령어 처리부
// ----------------------------------------------------
client.on('interactionCreate', (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;

    // 1. 관리자 명령어
    if (cmd === '할당') {
        const targetUser = interaction.options.getUser('멘션');
        const username = interaction.options.getString('유저네임');

        fs.readFile('Users.json', 'utf8', (err, data) => {
            let users = {};
            if (!err && data) {
                try { users = JSON.parse(data); } catch (e) {}
            }
            users[targetUser.id] = username;
            
            fs.writeFile('Users.json', JSON.stringify(users, null, 2), 'utf8', (writeErr) => {
                if (writeErr) return interaction.reply({ content: '할당 저장 중 오류가 발생했습니다.', ephemeral: true });
                interaction.reply({ content: `<@${targetUser.id}> 님에게 로블록스 계정 \`${username}\`이(가) 할당되었습니다!` });
            });
        });
        return;
    }

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

    if (cmd === '재시작') {
        // 기존 재시작 로직 유지 (순차 실행)
        const target = interaction.options.getString('대상');
        const shouldKill = interaction.options.getBoolean('로블록스종료');
        const macroDelaySec = interaction.options.getInteger('매크로대기');
        
        fs.readFile('settings.json', 'utf8', (err, data) => {
            if (err) return interaction.reply({ content: 'settings.json 파일을 찾을 수 없습니다.', ephemeral: true });
            
            let settings;
            try { settings = JSON.parse(data); } catch(e) { return interaction.reply({ content: 'settings.json 문법 오류', ephemeral: true }); }
            
            const link = settings.vip_link;
            const accounts = settings.accounts;
            const macroPath = path.join(process.cwd(), 'macro.ahk');

            if (!link) return interaction.reply({ content: 'settings.json에 vip_link가 없습니다.', ephemeral: true });

            const runSequential = (names, index) => {
                if (index >= names.length) return interaction.editReply(`✅ 모든 계정(${names.length}개) 재시작 완료.`);

                const name = names[index];
                const profile = accounts[name];
                const commandStr = `start "" chrome --profile-directory="${profile}" "${link}"`;

                interaction.editReply(`[${index + 1}/${names.length}] '${name}' 계정 실행 중... (${macroDelaySec}초 후 매크로)` );

                exec(commandStr, (execErr) => {
                    setTimeout(() => {
                        exec(`start "" "${macroPath}"`, () => {
                            setTimeout(() => { runSequential(names, index + 1); }, 3000);
                        });
                    }, macroDelaySec * 1000);
                });
            };

            interaction.reply('명령 처리를 시작합니다...').then(() => {
                if (shouldKill) {
                    exec('taskkill /f /im RobloxPlayerBeta.exe', () => {
                        setTimeout(() => { runSequential(target.toLowerCase() === 'all' ? Object.keys(accounts) : [target], 0); }, 2000);
                    });
                } else {
                    runSequential(target.toLowerCase() === 'all' ? Object.keys(accounts) : [target], 0);
                }
            });
        });
        return;
    }

    if (cmd === '컴퓨터재시작') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ 이 명령어는 서버 관리자만 사용할 수 있습니다.', ephemeral: true });
        }
        interaction.reply('⚠️ 5초 후 컴퓨터를 재시작합니다.').then(() => {
            setTimeout(() => { exec('shutdown /r /t 0'); }, 5000);
        });
        return;
    }

    // ====================================================
    // 일반 게임 연동 명령어 (LBC)
    // ====================================================
    if (activeUsers.has(interaction.user.id)) {
        return interaction.reply({ content: '⚠️ 이미 진행 중인 명령어가 있습니다.', ephemeral: true });
    }

    getAssignedUsername(interaction.user.id)
        .then(username => {
            activeUsers.add(interaction.user.id);
            interaction.reply({ content: '요청을 게임으로 전송 중입니다...' }).then(() => {
                
                // 단순 출력 계열
                if (cmd === '재접') return handleSimpleMessage(interaction, username, 'Rejoin');
                if (cmd === '스탯') return handleSimpleMessage(interaction, username, 'GetStats');
                if (cmd === '뽑기설정') return handleSimpleMessage(interaction, username, '뽑기설정');
                if (cmd === '몹스폰시간') return handleSimpleMessage(interaction, username, 'GetMobTime');
                if (cmd === '퀘스트보기') return handleSimpleMessage(interaction, username, 'GetQuests');

                // 옵션 매핑
                if (cmd === '구매') return handleSimpleMessage(interaction, username, 'Purchase', { ItemName: interaction.options.getString('itemname'), Amount: interaction.options.getInteger('amount') });
                if (cmd === '먹이') return handleSimpleMessage(interaction, username, 'UseTreat', { ItemName: interaction.options.getString('itemname'), Amount: interaction.options.getInteger('amount') });
                if (cmd === '구미') return handleSimpleMessage(interaction, username, 'UseEgg', { CON: interaction.options.getString('con'), EggName: 'GummyBeeJelly', Amount: 1 });
                if (cmd === '일반먹이') return handleSimpleMessage(interaction, username, '일반먹이', { CON: interaction.options.getString('con'), Amount: interaction.options.getInteger('amount'), Restocks: interaction.options.getString('restocks') });

                // 5. 벌집 (5x10 그리드 출력)
                if (cmd === '벌집') {
                    sendLbcRequest(username, 'GetHive')
                        .then(content => {
                            const hiveData = content.HiveData || [];
                            let gridText = '';
                            
                            // y=10이 위쪽, y=1이 아래쪽 (가장 왼쪽 아래가 1,1)
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

                            interaction.editReply({ content: `\`\`\`\n${gridText}\n\`\`\`` });
                            activeUsers.delete(interaction.user.id);
                        })
                        .catch(errMsg => {
                            interaction.editReply({ content: errMsg });
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

                    sendLbcRequest(username, 'GetHive', { CON: reqOptions.CON })
                        .then(content => {
                            const hiveData = content.HiveData || [];

                            if (hiveData.length > 1) {
                                const embed = new EmbedBuilder()
                                    .setColor(0xFFFF00)
                                    .setTitle('해당하는 셀이 여러 개입니다. 어떤 걸 선택하시겠습니까?');
                                
                                const row = new ActionRowBuilder();
                                hiveData.forEach((cellData, idx) => {
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
                                            executeSingleRoll(interaction, username, reqOptions, hiveData.find(c => c.Cell === chosenCell));
                                        });
                                    });

                                    collector.on('end', collected => {
                                        if (collected.size === 0) {
                                            interaction.editReply({ content: '입력 시간이 초과되었습니다.', components: [] });
                                            activeUsers.delete(interaction.user.id);
                                        }
                                    });
                                });
                            } else if (hiveData.length === 1) {
                                executeSingleRoll(interaction, username, reqOptions, hiveData[0]);
                            } else {
                                interaction.editReply({ content: '조건에 맞는 셀을 찾을 수 없습니다.' });
                                activeUsers.delete(interaction.user.id);
                            }
                        })
                        .catch(errMsg => {
                            interaction.editReply({ content: errMsg });
                            activeUsers.delete(interaction.user.id);
                        });
                }
            });
        })
        .catch(() => {
            interaction.reply({ content: `<@${interaction.user.id}> 할당된 계정이 없습니다.`, ephemeral: true });
        });
});
