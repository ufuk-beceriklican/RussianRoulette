const socket = io({
    transports: ['websocket', 'polling'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    autoConnect: true,
    query: {},
    debug: true
});
let playerName = '';
let currentRoom = '';
let shotCount = 0;
let isMyTurn = false;
let isWheelSpun = false;
let gameOver = false;
let currentPlayer = 1;
let players = [
    {isDead: false, isShielded: false, forcedShots: 0},
    {isDead: false, isShielded: false, forcedShots: 0}
];
let chamber = Math.floor(Math.random() * 6) + 1; // Mermi hangi odacıkta
let currentChamber = 1;
let doubleShot = false; // Çift kurşun joker durumu
let forcedShots = 0; // Zorunlu atış sayısı
let selectedJoker = null;
let hasSpunWheel = false; // Çarkın dönüp dönmediğini kontrol etmek için
let wheelSpinCount = {
    player1: 0,
    player2: 0
};
let player1Shots = 0;
let player2Shots = 0;
function joinGame() {
    playerName = document.getElementById('playerName').value;
    if (!playerName) {
        alert('Lütfen bir kovboy adı girin!');
        return;
    }
    socket.emit('join_game', {name: playerName});
}

socket.on('game_joined', (data) => {
    currentRoom = data.room;
    document.getElementById('waiting').style.display = 'none';
    document.getElementById('gameRoom').style.display = 'block';
    updatePlayers(data.players, data.scores);
    
    const playerCount = document.getElementById('playerCount');
    if (playerCount) {
        playerCount.textContent = data.players.length;
    }

    if (data.players.length === 2) {
        document.getElementById('gameStatus').innerHTML = 'Düello başladı! Çarkı çevirip joker kazanabilirsiniz.';
        
        // Çarkı görünür yap
        const wheelContainer = document.getElementById('wheel-container');
        if (wheelContainer) {
            wheelContainer.style.display = 'block';
        }
        
        // Çark butonunu aktifleştir
        const spinButton = document.getElementById('spin-wheel');
        if (spinButton) {
            spinButton.disabled = false;
            spinButton.onclick = function() {
                spinWheel();
            };
        }
        
        initializeGame();
        isMyTurn = playerName === data.players[0];
        updateTurnText();
        startGame();
    } else {
        document.getElementById('gameStatus').innerHTML = 'Rakip kovboy bekleniyor...';
    }
});

socket.on('game_status', (data) => {
    const gameStatus = document.getElementById('gameStatus');
    gameStatus.innerHTML = data.message;
    
    // Sıra kontrolünü güncelle
    isMyTurn = playerName === data.currentPlayer;
    document.getElementById('triggerBtn').disabled = !isMyTurn;
    
    if (isMyTurn) {
        document.getElementById('currentTurn').textContent = 'Senin sıran, kovboy!';
        playSound('your-turn.mp3');
    } else {
        document.getElementById('currentTurn').textContent = 'Rakibin sırası...';
    }
});

socket.on('game_over', (data) => {
    gameOver = true;
    const gameStatus = document.getElementById('gameStatus');
    
    // Kazananı ve skorları göster
    let scoreHtml = `
        <div class="game-over-message">
            <h2>${data.winner} Kazandı!</h2>
            <div class="final-scores">
                <p>Skorlar:</p>
                ${Object.entries(data.scores).map(([player, score]) => 
                    `<p>${player}: ${score} puan</p>`
                ).join('')}
            </div>
        </div>
    `;
    
    // Restart butonu ekle
    scoreHtml += `
        <button id="restartButton" class="restart-btn" onclick="restartGame()">
            <span class="restart-icon">🔄</span>
            Yeniden Başla
        </button>
    `;
    
    gameStatus.innerHTML = scoreHtml;
    
    // Diğer butonları devre dışı bırak
    document.getElementById('triggerBtn').disabled = true;
    if (document.getElementById('available-joker')) {
        document.getElementById('available-joker').style.display = 'none';
    }
    
    // Çark containerını gizle
    document.getElementById('wheel-container').style.display = 'none';
    
    // Skorları güncelle
    updateScores(data.scores);
    playSound('game-over.mp3');
});
document.addEventListener("DOMContentLoaded", function () {
    updatePlayers([], {});
});


function updatePlayers(players, scores = {}) {
    const player1Elem = document.getElementById('player1');
    const player2Elem = document.getElementById('player2');
    
    if (players.length > 0) {
        const player1Name = players[0];
        player1Elem.innerHTML = `
            <div class="player-avatar">
                <div class="player-health-bar">
                    <div class="health-fill"></div>
                </div>
            </div>
            <div class="player-info">
                <div class="player-name">${player1Name}</div>
                <div class="player-score">Skor: ${scores[player1Name] || 0}</div>
                <div class="player-shots">Atış: ${player1Shots}/6</div>
            </div>
        `;
        player1Elem.setAttribute('data-player', player1Name);
        player1Elem.classList.add('active-player');
    }
    
    if (players.length > 1) {
        const player2Name = players[1];
        player2Elem.innerHTML = `
            <div class="player-avatar">
                <div class="player-health-bar">
                    <div class="health-fill"></div>
                </div>
            </div>
            <div class="player-info">
                <div class="player-name">${player2Name}</div>
                <div class="player-score">Skor: ${scores[player2Name] || 0}</div>
                <div class="player-shots">Atış: ${player2Shots}/6</div>
            </div>
        `;
        player2Elem.setAttribute('data-player', player2Name);
        player2Elem.classList.add('active-player');
    } else {
        player2Elem.innerHTML = '<div class="player-name">Rakip Bekleniyor...</div>';
        player2Elem.classList.remove('active-player');
    }
}

function showMuzzleFlash(playerIndex) {
    const muzzleFlash = document.querySelector(`.muzzle-flash.${playerIndex === 0 ? 'left' : 'right'}`);
    muzzleFlash.style.opacity = '1';
    
    setTimeout(() => {
        muzzleFlash.style.opacity = '0';
    }, 100);
}

function animateGun(playerIndex) {
    const gun = document.querySelector(`.gun-${playerIndex === 0 ? 'left' : 'right'}`);
    gun.style.transform = `rotate(${playerIndex === 0 ? '-' : ''}20deg)`;
    
    setTimeout(() => {
        gun.style.transform = 'none';
    }, 200);
}

function pullTrigger() {
    if (!isMyTurn) {
        console.error('Sıra sizde değil!');
        return;
    }

    const triggerBtn = document.getElementById('triggerBtn');
    if (triggerBtn) {
        triggerBtn.disabled = true;
    }

    // Atış sayısını artır
    if (playerName === players[0]) {
        player1Shots++;
        document.getElementById('shotCount').textContent = `Atış: ${player1Shots}/6`;
    } else {
        player2Shots++;
        document.getElementById('shotCount').textContent = `Atış: ${player2Shots}/6`;
    }

    // Kan efekti ve animasyonlar
    showShootingEffects();

    const data = {
        room: currentRoom,
        player: playerName,
        isShielded: players[currentPlayer - 1].isShielded,
        doubleShot: doubleShot,
        forcedShots: forcedShots
    };

    socket.emit('pull_trigger', data);
}

// Ses efektleri
const sounds = {};
function playSound(soundName) {
    try {
        if (!sounds[soundName]) {
            sounds[soundName] = new Audio(`/static/${soundName}`);
            // Ses yüklendiğinde hata ayıklama
            sounds[soundName].addEventListener('error', (e) => {
                console.error(`Ses dosyası yüklenemedi: ${soundName}`, e);
            });
            
            // Ses yüklendiğinde hazır olduğunu kontrol et
            sounds[soundName].addEventListener('canplaythrough', () => {
                console.log(`Ses dosyası hazır: ${soundName}`);
            });
        }
        
        // Ses çalmayı dene
        const playPromise = sounds[soundName].play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    sounds[soundName].currentTime = 0; // Sesi başa sar
                })
                .catch(err => {
                    console.error(`Ses çalınamadı: ${soundName}`, err);
                    // Kullanıcı etkileşimi gerekiyorsa bildir
                    if (err.name === 'NotAllowedError') {
                        console.log('Tarayıcı ses izni gerekiyor');
                    }
                });
        }
    } catch (err) {
        console.error('Ses sistemi hatası:', err);
    }
}

// Ses dosyalarını önceden yükle
const soundFiles = [
    'gunshot.mp3',
    'click.mp3',
    'duel-start.mp3',
    'your-turn.mp3',
    'game-over.mp3'
];

// Sayfa yüklendiğinde sesleri hazırla
window.addEventListener('load', () => {
    soundFiles.forEach(soundFile => {
        const audio = new Audio(`/static/${soundFile}`);
        sounds[soundFile] = audio;
        // Sesi yükle ama çalma
        audio.load();
    });
});

socket.on('trigger_result', (data) => {
    console.log('Trigger result:', data);
    
    if (data.hit) {
        if (data.shielded) {
            playSound('shield.mp3');
            updateGameStatus("Koruma kalkanı kullanıldı! Hayatta kaldın!");
            players[currentPlayer - 1].isShielded = false;
        } else {
            playSound('gunshot.mp3');
            const flash = document.createElement('div');
            flash.className = 'screen-flash';
            document.body.appendChild(flash);
            setTimeout(() => flash.remove(), 200);
            gameOver = true;
            updateGameStatus("Oyun bitti!");
        }
    } else {
        playSound('click.mp3');
        
        if (data.double_shot_active) {
            if (data.shots_remaining > 0) {
                if (isMyTurn) {
                    document.getElementById('triggerBtn').disabled = false;
                    updateGameStatus(`Bir atış daha yapmalısın! (Kalan: ${data.shots_remaining})`);
                }
            }
        } else {
            updateGameStatus("*klik*");
            isMyTurn = data.next_player === playerName;
            document.getElementById('triggerBtn').disabled = !isMyTurn;
            updateTurnText();
        }
    }
});

// Bağlantı kopması durumu
socket.on('disconnect', (reason) => {
    console.log('Bağlantı koptu:', reason);
    if (reason === 'io server disconnect') {
        socket.connect();
    }
    alert('Bağlantı koptu! Sayfa yenileniyor...');
    location.reload();
});

// Hata durumu
socket.on('error', (error) => {
    console.error('Socket hatası:', error);
    alert('Bir hata oluştu: ' + (error.message || 'Bilinmeyen hata'));
});

function initializeGame() {
    // Çark butonunu aktifleştir
    document.getElementById('available-joker').style.display = selectedJoker ? 'block' : 'none';
    const spinButton = document.getElementById('spin-wheel');
    if (spinButton) {
        spinButton.disabled = false;
        spinButton.onclick = spinWheel; // spinWheel fonksiyonunu doğrudan bağla
    }
}

function spinWheel() {
    // Her oyuncunun çark hakkını kontrol et
    const currentPlayerSpins = wheelSpinCount[playerName] || 0;
    
    if (currentPlayerSpins >= 1) {
        updateGameStatus("Bu el için çark hakkınızı kullandınız!");
        return;
    }
    
    console.log('Çark döndürülüyor...');
    
    const wheel = document.getElementById('wheel');
    const spinButton = document.getElementById('spin-wheel');
    
    if (!wheel || !spinButton) {
        console.error('Çark veya buton bulunamadı!');
        return;
    }
    
    // Çark hakkını kullan
    wheelSpinCount[playerName] = 1;
    spinButton.disabled = true;
    
    const degrees = Math.floor(Math.random() * 360) + (5 * 360);
    wheel.style.transition = 'transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
    wheel.style.transform = `rotate(${degrees}deg)`;
    
    socket.emit('wheel_spun', {
        room: currentRoom,
        player: playerName
    });
    
    setTimeout(() => {
        const selectedSection = getSelectedSection(degrees);
        selectedJoker = selectedSection;
        
        const jokerButton = document.getElementById('available-joker');
        if (jokerButton && selectedSection !== 'none') {
            jokerButton.style.display = 'block';
            jokerButton.innerHTML = createJokerButtonContent(selectedSection);
            updateGameStatus(`${getJokerName(selectedSection)} jokeri kazandınız!`);
        } else {
            updateGameStatus("Maalesef joker kazanamadınız!");
        }
    }, 3000);
}

function getSelectedSection(degrees) {
    // Normalize the degrees (0-360 arasına getir)
    const normalizedDegree = (360 - (degrees % 360)) % 360;
    const sectionSize = 360 / 4;

    // Bölümlerin başlangıç açıları
    if (normalizedDegree >= 0 && normalizedDegree < sectionSize) {
        return "skip";
    } else if (normalizedDegree >= sectionSize && normalizedDegree < sectionSize * 2) {
        return "shield";
    } else if (normalizedDegree >= sectionSize * 2 && normalizedDegree < sectionSize * 3) {
        return "double";
    } else {
        return "none";
    }
}
    
    // Butonun onclick olayını bağla
    document.getElementById('spin-wheel').onclick = spinWheel;

function getJokerName(joker) {
    const names = {
        'skip': 'Pas Geç',
        'shield': 'Koruma',
        'double': 'Çift Kurşun'
    };
    return names[joker] || joker;
}

function useJoker() {
    console.log('Joker kullanılıyor:', selectedJoker);
    
    if (!selectedJoker || gameOver) {
        console.log('Joker kullanılamıyor:', {selectedJoker, gameOver});
        return;
    }

    const data = {
        room: currentRoom,
        joker_type: selectedJoker,
        player: playerName
    };

    // Joker butonunu hemen gizle
    const jokerButton = document.getElementById('available-joker');
    if (jokerButton) {
        jokerButton.style.display = 'none';
    }

    socket.emit('use_joker', data);
    selectedJoker = null;
}

// Socket event listener'larını güncelle
socket.on('double_shot_activated', (data) => {
    console.log('Double shot activated:', data);
    
    if (data.player === playerName) {
        // Jokeri kullanan oyuncuyum
        isMyTurn = false;
        doubleShot = false;
        document.getElementById('triggerBtn').disabled = true;
        updateGameStatus("Çift kurşun jokeri aktifleştirildi! Rakibin iki atış yapması gerekiyor.");
    } else {
        // Rakip jokeri kullandı, benim iki kez ateş etmem gerekiyor
        isMyTurn = true;
        doubleShot = true;
        forcedShots = 2;
        document.getElementById('triggerBtn').disabled = false;
        updateGameStatus("Rakip çift kurşun jokeri kullandı! İki kez ateş etmelisin!");
    }
    updateTurnText();
});

socket.on('shield_activated', (data) => {
    console.log('Shield activated:', data);
    if (data.player === playerName) {
        players[currentPlayer - 1].isShielded = true;
        updateGameStatus("Koruma kalkanı aktif! Bir sonraki vuruşta ölmeyeceksin!");
    } else {
        updateGameStatus(data.message);
    }
});

socket.on('turn_skipped', (data) => {
    console.log('Turn skipped:', data);
    isMyTurn = data.next_player === playerName;
    document.getElementById('triggerBtn').disabled = !isMyTurn;
    updateGameStatus(data.message);
    updateTurnText();
});

function updateTurnText() {
    const currentTurn = document.getElementById('currentTurn');
    if (currentTurn) {
        if (isMyTurn) {
            currentTurn.textContent = 'Senin sıran, kovboy!';
        } else {
            currentTurn.textContent = 'Rakibin sırası...';
        }
    }
}

function updateGameStatus(message) {
    const gameStatus = document.getElementById('gameStatus');
    if (gameStatus) {
        gameStatus.innerHTML = message;
    }
}

function startGame() {
    document.getElementById('gameStatus').innerHTML = 'Düello başladı! Çarkı çevirip joker kazanabilirsiniz.';
    // Tetik butonunu sıra kontrolüne göre aktif/pasif yap
    document.getElementById('triggerBtn').disabled = !isMyTurn;
    playSound('duel-start.mp3');
}

socket.on('force_next_shot', (data) => {
    if (playerName === data.current_player) {
        document.getElementById('triggerBtn').disabled = false;
        updateGameStatus(`${data.shots_remaining} atış daha yapmalısın!`);
    }
});

// Bağlantı durum takibi
socket.on('connect', () => {
    console.log('Socket.IO bağlantısı başarılı!');
});

socket.on('connect_error', (error) => {
    console.error('Bağlantı hatası:', error);
    alert('Sunucuya bağlanırken bir hata oluştu. Lütfen sayfayı yenileyin.');
});

// Skor gösterimi için yeni fonksiyon
function updateScores(scores) {
    Object.entries(scores).forEach(([playerName, score]) => {
        const playerElements = document.querySelectorAll('.player');
        playerElements.forEach(element => {
            if (element.getAttribute('data-player') === playerName) {
                const scoreElement = element.querySelector('.player-score');
                if (scoreElement) {
                    scoreElement.textContent = `Skor: ${score}`;
                }
            }
        });
    });
}

// Restart fonksiyonunu güncelle
function restartGame() {
    const data = {
        room: currentRoom,
        player: playerName
    };
    
    socket.emit('restart_game', data);
    
    // Tüm durumları sıfırla
    hasSpunWheel = false;
    isWheelSpun = false;
    selectedJoker = null;
    doubleShot = false;
    forcedShots = 0;
    players = [
        {isDead: false, isShielded: false, forcedShots: 0},
        {isDead: false, isShielded: false, forcedShots: 0}
    ];
    
    // UI'ı sıfırla
    document.getElementById('shotCount').textContent = 'Atış: 0/6';
    document.getElementById('gameStatus').innerHTML = 'Oyun yeniden başlatılıyor...';
    
    // Çarkı ve butonları sıfırla
    const wheelContainer = document.getElementById('wheel-container');
    const spinButton = document.getElementById('spin-wheel');
    const jokerButton = document.getElementById('available-joker');
    
    if (wheelContainer) wheelContainer.style.display = 'block';
    if (spinButton) spinButton.disabled = false;
    if (jokerButton) jokerButton.style.display = 'none';
    
    // Çark haklarını sıfırla
    wheelSpinCount = {
        player1: 0,
        player2: 0
    };
}
document.querySelector('.close').onclick = function() {
    const modal = document.getElementById('introModal');
    modal.classList.add('hide');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
};
socket.on('game_restarted', (data) => {
    // Oyun durumunu sıfırla
    gameOver = false;
    shotCount = 0;
    isWheelSpun = false;
    selectedJoker = null;
    
    // Çark haklarını sıfırla
    wheelSpinCount = {
        [data.players[0]]: 0,
        [data.players[1]]: 0
    };
    
    // UI'ı güncelle
    document.getElementById('wheel-container').style.display = 'block';
    document.getElementById('spin-wheel').disabled = false;
    document.getElementById('triggerBtn').disabled = !isMyTurn;
    document.getElementById('gameStatus').innerHTML = 'Düello başladı! Çarkı çevirip joker kazanabilirsiniz.';
    
    // Restart butonunu gizle
    const restartButton = document.getElementById('restartButton');
    if (restartButton) {
        restartButton.style.display = 'none';
    }
    
    // Skorları güncelle
    updateScores(data.scores);
    
    // Sırayı güncelle
    isMyTurn = playerName === data.currentPlayer;
    updateTurnText();
    
    playSound('duel-start.mp3');
});

// Modal kontrolleri
window.onload = function() {
    const modal = document.getElementById('introModal');
    const closeBtn = document.getElementsByClassName('close')[0];
    const startBtn = document.querySelector('.start-game-btn');

    // Modal'ı göster
    modal.classList.add('show');

    // Çarpı butonuna tıklandığında
    closeBtn.onclick = function() {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }

    // "Maceraya Başla" butonuna tıklandığında
    startBtn.onclick = function() {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }

    // Modal dışına tıklandığında
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);
        }
    }
}

function createJokerButtonContent(jokerType) {
    const jokerIcons = {
        'skip': '⏭️',
        'shield': '🛡️',
        'double': '🎯'
    };
    
    // Joker container oluştur
    const container = document.createElement('div');
    container.className = 'joker-container';
    
    // Joker butonu oluştur
    const button = document.createElement('div');
    button.className = 'joker-button';
    button.setAttribute('data-joker', jokerType);
    button.onclick = useJoker;
    
    button.innerHTML = `
        <span class="joker-icon">${jokerIcons[jokerType]}</span>
        <span class="joker-name">${getJokerName(jokerType)}</span>
    `;
    
    container.appendChild(button);
    return container.outerHTML;
}

// Yeni efekt fonksiyonları
function showShootingEffects() {
    // Ateş etme efekti
    const muzzleFlash = document.createElement('div');
    muzzleFlash.className = 'muzzle-flash';
    document.body.appendChild(muzzleFlash);
    
    setTimeout(() => muzzleFlash.remove(), 100);

    // Ekran sarsıntısı
    document.body.classList.add('screen-shake');
    setTimeout(() => document.body.classList.remove('screen-shake'), 200);

    // Ses efekti
    playSound('gunshot.mp3');
}

// Kan efekti için yeni fonksiyon
function showBloodEffect(playerElement) {
    const bloodSpray = document.createElement('div');
    bloodSpray.className = 'blood-spray';
    playerElement.appendChild(bloodSpray);
    
    setTimeout(() => bloodSpray.remove(), 1000);
}
