const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const https = require('https');
const CLIENT_ID = '1488720287523541152';
const GUILD_ID = '1458078510030786704';
const GITHUB_RAW_URL = 'https://gist.githubusercontent.com/iwantteam0303-tech/60149702255f4787681e810e9587ffd9/raw/BeeBot';
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});
// 슬래시 명령어 정의
const commands = [
    new SlashCommandBuilder()
        .setName('업데이트')
        .setDescription('깃허브에서 최신 코드를 가져와 봇을 재시작합니다.')
].map(command => command.toJSON());
// token.txt 파일을 읽어와서 봇 로그인 및 명령어 등록 진행
fs.readFile('token.txt', 'utf8', (err, data) => {
    if (err) {
        console.error('token.txt 파일을 읽는 중 오류가 발생했습니다. 파일이 폴더에 있는지 확인해 주세요.');
        return;
    }
    // 텍스트 파일 내용 앞뒤의 공백이나 줄바꿈 제거 후 토큰으로 사용
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
    if (interaction.commandName === '업데이트') {
        interaction.reply('업데이트를 시작합니다. 잠시만 기다려 주세요...')
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
