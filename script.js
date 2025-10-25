// --- FIREBASE TANIMLARI (HTML'DEN GELEN GLOBAL DEĞİŞKENLER) ---
// HTML'deki script bloğu, gerekli Firebase nesnelerini (window.firebaseDb, window.currentUserId) 
// ve App ID'yi (HTML'de tanımlanan proje ID) global olarak ayarlar.
// Bu dosya bu global nesnelere güvenir.

async function getFirestoreFunctions() {
    // Firestore fonksiyonlarını dinamik olarak yükle (GitHub Pages'ta standart import)
    if (window.firebaseDb && window.firebaseAuth) {
        return {
            db: window.firebaseDb,
            auth: window.firebaseAuth,
            addDoc: (await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js")).addDoc,
            collection: (await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js")).collection,
            serverTimestamp: (await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js")).serverTimestamp,
        };
    } else {
        // Yükleme bekleniyor veya hata
        console.warn("Firestore fonksiyonları veya kullanıcı ID'si mevcut değil. Kayıt işlemi bekletiliyor.");
        // Gecikme ile tekrar deneme yapılabilir, ancak burada basitçe null döndürüyoruz.
        return null; 
    }
}
// --- FIREBASE TANIMLARI SONU ---


// --- GEMINI API ENTEGRASYON BÖLÜMÜ ---
// Koç Yorumu için Gemini API, bu ortam dışında çalışmayabilir.
const apiKey = ""; 
const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

/**
 * Gemini API'yi çağırmak için üstel geri çekilmeyi kullanan yardımcı fonksiyon.
 */
async function callGeminiAPI(payload, maxRetries = 3) {
    // GitHub Pages'ta API anahtarı boş olacağı için bu fonksiyon çalışmayacaktır.
    if (!apiKey) {
        return { text: "Yapay Zeka Koçu hizmeti, API anahtarı ayarlanmadığı için bu ortamda devre dışıdır.", sources: [] };
    }
    
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorBody = await response.json();
                throw new Error(`API hatası ${response.status}: ${JSON.stringify(errorBody)}`);
            }

            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "Yorum alınamadı.";
            return { text: text, sources: [] };

        } catch (error) {
            lastError = error;
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(toResolve => setTimeout(toResolve, delay));
        }
    }
    console.error("Gemini API çağrısı başarısız oldu:", lastError);
    return { text: "Yapay Zeka Koçu şu an meşgul. Tekrar deneyin.", sources: [] };
}

/**
 * Gemini'ye skoru gönderir ve yorum alır.
 */
async function generateCommentary(currentScore, highScore, playerName) {
    const aiCommentaryDiv = document.getElementById('aiCommentary');
    const geminiButton = document.getElementById('geminiButton');
    
    geminiButton.disabled = true;
    aiCommentaryDiv.innerHTML = '<span class="text-yellow-400">Yapay Zeka Koçu Düşünüyor...</span>';

    const systemPrompt = "Sen, 'Evolve Snake 2D' oyununun alaycı ama motive edici Yapay Zeka Koçusun. Oyuncunun skorunu analiz et ve 50 kelimeyi geçmeyecek şekilde, biraz iğneleyici, biraz cesaret verici, ama her zaman komik bir yorum yap. Global bir liderlik tablosundan geliyormuş gibi konuş. Oyuncuya adı (eğer varsa) ile hitap et. Skoru 100'ün altındaysa başarısızlıkla dalga geç, 200'ün üzerindeyse ise hafifçe öv. Yorumu Türkçe yap.";
    const userQuery = `Oyuncu adı: ${playerName}. Skorum: ${currentScore}. En yüksek skorum: ${highScore}. Oyunu kaybettim. Ne düşünüyorsun?`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    const result = await callGeminiAPI(payload);

    geminiButton.disabled = false;
    aiCommentaryDiv.textContent = result.text;
}
// --- GEMINI API ENTEGRASYON BÖLÜMÜ SONU ---


// Audio Context'i başlat
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// Ses Oluşturma Fonksiyonu
function playTone(frequency, duration, type) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);

    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
}

// --- SABİTLER ---
const TILE_SIZE = 20; // Kare boyutu (piksel)
const GRID_SIZE = 20; // 20x20 ızgara
const CANVAS_WIDTH = TILE_SIZE * GRID_SIZE;
const CANVAS_HEIGHT = TILE_SIZE * GRID_SIZE;
const INITIAL_GAME_SPEED = 100; // Mantık güncellemesi 100ms'de bir 
const MIN_GAME_SPEED = 50; // Ulaşılabilecek en yüksek hız (daha küçük ms = daha hızlı)
const SPEED_INCREASE_INTERVAL = 50; // Her 50 puanda hızlanma
// Yiyecek otomatik olarak yeniden çıkma süresi (5 saniye maksimum ömür)
const FOOD_COOLDOWN_MS = 5000; 
// App ID, HTML'deki Firebase projesinin ID'sinden alınacak.
const APP_ID = window.firebaseApp?.options?.projectId || 'default-app-id';

// Food Tipleri ve Özellikleri
const FOOD_TYPES = {
    REGULAR: { color: '#48bb78', score: 10, effect: null, duration: 0, rarity: 60 }, // Yeşil
    POISON: { color: '#e53e3e', score: -20, effect: 'LOSE_TAIL', duration: 0, rarity: 25 }, // Kırmızı
    SPEED: { color: '#f6e05e', score: 10, effect: 'SPEED_UP', duration: 5000, rarity: 10 }, // Sarı
    INVINCIBILITY: { color: '#63b3ed', score: 0, effect: 'INVINCIBLE', duration: 7000, rarity: 5 } // Mavi
};

// --- DOM ELEMENTLERİ ---
const canvas = document.getElementById('snakeCanvas');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const geminiButton = document.getElementById('geminiButton'); 
const aiCommentary = document.getElementById('aiCommentary'); 
const gameMenu = document.getElementById('game-menu');
const gameInfo = document.getElementById('game-info');
const scoreDisplay = document.getElementById('score');
const highScoreDisplay = document.getElementById('high-score');
const messageBox = document.getElementById('messageBox');
const messageTitle = document.getElementById('messageTitle');
const messageText = document.getElementById('messageText');
const restartButtonGameOver = document.getElementById('restartButtonGameOver'); 
const restartButtonInGame = document.getElementById('restartButtonInGame');
const playerNameInput = document.getElementById('playerNameInput');
const gameModeSelect = document.getElementById('gameModeSelect');
const pauseScreen = document.getElementById('pause-screen');
const dashFill = document.getElementById('dash-fill');
const activePowerupDisplay = document.getElementById('active-powerup');
const foodTimerDisplay = document.getElementById('foodTimerDisplay'); 
const mobilePauseButton = document.getElementById('mobilePauseButton'); // YENİ: Mobil Duraklat Butonu
const mobileControls = document.getElementById('mobile-controls'); // YENİ: Mobil Kontrol Alanı

// Canvas'ı Ayarla
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

// Elma Görseli (Placeholder olarak kalır)
const appleImage = new Image();
appleImage.src = "apple.png"; 

// --- SINIFLAR ---

/**
 * Yılanın tüm hareket ve gövde mantığını yönetir.
 */
class Snake {
    constructor(tileSize, gridSize) {
        this.tileSize = tileSize;
        this.gridSize = gridSize;
        this.body = [
            { x: 10 * tileSize, y: 10 * tileSize },
            { x: 9 * tileSize, y: 10 * tileSize },
            { x: 8 * tileSize, y: 10 * tileSize }
        ];
        this.prevSegments = JSON.parse(JSON.stringify(this.body));
        this.dx = tileSize;
        this.dy = 0;
        this.lastDirection = { x: tileSize, y: 0 };
        this.inputQueue = [];
    }

    // Yılanın yönünü değiştirmek için girişi kuyruğa ekler
    changeDirection(newDx, newDy) {
        // Geriye dönmeyi engelleme kontrolü
        if (!((newDx === -this.lastDirection.x && newDx !== 0) || 
              (newDy === -this.lastDirection.y && newDy !== 0))) {
            this.inputQueue.push({ x: newDx, y: newDy });
        }
    }

    // Yılanı bir kare ilerletir
    move() {
        this.prevSegments = JSON.parse(JSON.stringify(this.body));

        if (this.inputQueue.length > 0) {
            const nextDirection = this.inputQueue.shift();
            this.dx = nextDirection.x;
            this.dy = nextDirection.y;
            this.lastDirection = nextDirection;
        }

        const head = { x: this.body[0].x + this.dx, y: this.body[0].y + this.dy };
        this.body.unshift(head);
    }
}

/**
 * Yiyeceklerin pozisyonunu, tipini ve etkilerini yönetir.
 */
class Food {
    constructor(tileSize, gridSize, snakeBody) {
        this.tileSize = tileSize;
        this.gridSize = gridSize;
        this.spawn(snakeBody);
    }

    // Yeni bir yiyecek pozisyonu ve tipi belirler
    spawn(snakeBody) {
        let newFood;
        let attempts = 0;
        do {
            newFood = {
                x: Math.floor(Math.random() * this.gridSize) * this.tileSize,
                y: Math.floor(Math.random() * this.gridSize) * this.tileSize
            };
            attempts++;
            if (attempts > 100) break; // Sonsuz döngüyü engelle
        } while (this._isFoodOnSnake(newFood, snakeBody));

        this.position = newFood;
        this.type = this._determineType();
    }
    
    // Yiyecek tipini nadirlik oranlarına göre belirler
    _determineType() {
        const totalRarity = Object.values(FOOD_TYPES).reduce((sum, item) => sum + item.rarity, 0);
        let rand = Math.random() * totalRarity;

        for (const type in FOOD_TYPES) {
            rand -= FOOD_TYPES[type].rarity;
            if (rand <= 0) {
                return type;
            }
        }
        return 'REGULAR';
    }

    _isFoodOnSnake(newFood, snakeBody) {
        return snakeBody.some(segment => segment.x === newFood.x && segment.y === newFood.y);
    }
}


/**
 * Oyunun ana döngüsünü, durumunu ve görselleştirmesini yönetir.
 */
class Game {
    constructor() {
        this.highScore = parseInt(localStorage.getItem('snakeHighScore') || 0);
        this.updateScoreDisplay();
        
        // Oyun Durumları
        this.isRunning = false;
        this.isPaused = false;
        this.gameMode = '';

        // Zamanlama Değişkenleri
        this.snake = null;
        this.food = null;
        this.score = 0;
        this.gameSpeed = INITIAL_GAME_SPEED;
        this.lastUpdate = 0;
        this.interpolationTime = 0;
        this.animationFrameId = null;
        
        // Yiyecek Zamanlayıcısı
        this.nextFoodTime = 0;

        // Dash & Güçlendirme Yönetimi
        this.isDashing = false;
        this.dashCostTimer = 0; // Hızlanma maliyeti sayacı
        this.maxDashCost = 6;
        this.activePowerup = { type: null, endTime: 0 };
        
        // Menüyü başlat
        this.showMenu(); 
    }
    
    // Yiyecek zamanlayıcısını başlatır/sıfırlar.
    resetFoodTimer() {
        this.nextFoodTime = performance.now() + FOOD_COOLDOWN_MS;
    }

    // Menü Ekranını Göster
    showMenu() {
        this.isRunning = false;
        this.isPaused = false;
        gameMenu.style.display = 'flex';
        gameInfo.style.display = 'none';
        pauseScreen.style.display = 'none'; 
        messageBox.style.display = 'none'; 
        mobileControls.style.display = 'none'; // Mobil kontrolleri gizle
        
        // Oyun döngüsü çalışıyorsa durdur
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    // Oyunu Başlat
    initialize() {
        this.playerName = playerNameInput.value.trim() || "İsimsiz Oyuncu";
        this.gameMode = gameModeSelect.value;
        
        // Yeniden Başlatma/Başlatma İşlemleri
        this.snake = new Snake(TILE_SIZE, GRID_SIZE);
        this.food = new Food(TILE_SIZE, GRID_SIZE, this.snake.body);
        this.score = 0;
        this.gameSpeed = INITIAL_GAME_SPEED;
        this.isRunning = true;
        this.isPaused = false;
        this.isDashing = false;
        this.dashCostTimer = 0;
        this.activePowerup = { type: null, endTime: 0 };
        this.lastUpdate = 0; 
        this.resetFoodTimer(); // Oyun başladığında ilk zamanlayıcıyı başlat

        // Arayüz Güncellemeleri
        this.updateScoreDisplay();
        gameMenu.style.display = 'none';
        gameInfo.style.display = 'flex';
        messageBox.style.display = 'none';
        pauseScreen.style.display = 'none';
        mobileControls.style.display = 'flex'; // Mobil kontrolleri göster (CSS media query ile kontrol edilecek)
        aiCommentary.textContent = '';
        // API anahtarı yoksa düğmeyi devre dışı bırak
        geminiButton.disabled = !apiKey; 
        activePowerupDisplay.textContent = '';
        // Başlangıç değerini 5.0 saniye olarak göster
        foodTimerDisplay.textContent = `Yem Süresi: ${(FOOD_COOLDOWN_MS / 1000).toFixed(1)}s`;
        
        // Ses
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(e => console.error("Audio resume failed:", e));
        }

        // Oyun döngüsünü başlat
        if (!this.animationFrameId) {
            this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
        }
        
        // İlk çizimi yap
        this.draw(0, 0); 
    }
    
    // Oyunu Duraklat / Devam Ettir
    togglePause() {
        if (!this.isRunning) return; 

        this.isPaused = !this.isPaused;
        if (this.isPaused) {
            pauseScreen.style.display = 'flex'; 
            mobilePauseButton.textContent = 'DEVAM ET';
            playTone(180, 0.1, 'sawtooth');
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null; 
            this.lastPauseTime = performance.now();
        } else {
            pauseScreen.style.display = 'none'; 
            mobilePauseButton.textContent = 'DURAKLAT';
            // Devam ettiğinde zamanlamayı düzeltmek için lastUpdate'i sıfırla
            this.lastUpdate = performance.now(); 
            // Pause süresini nextFoodTime'a ekleyelim.
            const pauseDuration = performance.now() - this.lastPauseTime;
            this.nextFoodTime += pauseDuration;

            playTone(300, 0.1, 'sawtooth');
            if (!this.animationFrameId) {
                 this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
            }
        }
    }

    // Yiyecek Etkisini Yönet
    applyFoodEffect(foodType) {
        const foodProps = FOOD_TYPES[foodType];
        // Puanı güncelle
        this.score += foodProps.score; 
        
        if (foodProps.effect) {
            this.activePowerup.type = foodProps.effect;
            this.activePowerup.endTime = performance.now() + foodProps.duration;

            if (foodProps.effect === 'LOSE_TAIL' && this.snake.body.length > 3) {
                // Zehir yendiğinde kuyruk kısaltma (2 segment silinir)
                this.snake.body.pop(); 
                this.snake.body.pop();
            }
        }

        // Yem yendiğinde yeni yemi spawn et ve zamanlayıcıyı sıfırla
        this.food.spawn(this.snake.body);
        this.resetFoodTimer();
    }
    
    // Oyun Mantığı Güncelleme Hızını Hesapla
    get currentSpeed() {
        let speed = this.gameSpeed;
        if (this.activePowerup.type === 'SPEED_UP') {
            speed /= 2;
        }
        // Hızlanma (Dash) her zaman daha hızlıdır
        return this.isDashing ? speed / 3 : speed; 
    }

    // Ana Oyun Döngüsü
    gameLoop(currentTime) {
        if (!this.isRunning) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
            return;
        }
        
        if (!this.isPaused) {
            const timeSinceLastUpdate = currentTime - this.lastUpdate;
            const updateSpeed = this.currentSpeed;

            if (timeSinceLastUpdate >= updateSpeed) {
                this.lastUpdate = currentTime;
                this.update(currentTime); // currentTime'ı update'e geçir
                this.interpolationTime = 0;
            } else {
                this.interpolationTime = timeSinceLastUpdate;
            }
        } else {
            this.interpolationTime = 0;
        }

        this.draw(this.currentSpeed, this.interpolationTime);
        this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
    }

    // Oyun Mantığını Güncelle
    update(currentTime) {
        this.checkFoodCooldown(currentTime); // Yiyecek ömrü (5 saniye) kontrolü
        this.checkPowerupExpiration();
        this.handleDashCost();
        this.snake.move();

        const head = this.snake.body[0];
        
        // Çarpışma Kontrolleri
        if (this.checkCollision(head)) {
            this.gameOver();
            return;
        }

        let foodWasEaten = false;
        // Yem Yeme Kontrolü
        if (head.x === this.food.position.x && head.y === this.food.position.y) {
            const foodType = this.food.type;
            const foodProps = FOOD_TYPES[foodType];
            
            this.applyFoodEffect(foodType);
            playTone(440, 0.1, 'sine');
            foodWasEaten = true;
            
            // Yılan boyunu yönetme (move() bir segment eklediği için)
            if (foodProps.score > 0) {
                 // Yılan büyüyor: move() ile eklenen segment kalır. checkSpeedIncrease çağrılır.
                 this.checkSpeedIncrease();
            } else if (foodProps.score === 0) {
                // Yılanın boyu değişmez (INVINCIBILITY): move() ile eklenen segmenti geri çıkar.
                this.snake.body.pop(); 
            }
            // LOSE_TAIL (-20 Puan): applyFoodEffect 2 segment sildi. move() 1 segment ekledi. Net: -1 segment.
        } 
        
        if (!foodWasEaten) {
            // Yem yenmedi, move() ile eklenen segmenti sil (normal hareket)
            this.snake.body.pop();
        }

        this.updateScoreDisplay();
    }
    
    // Yiyecek Cooldown Kontrolü (5 saniyelik maksimum ömür)
    checkFoodCooldown(currentTime) {
        let remainingTime = Math.max(0, this.nextFoodTime - currentTime);
        
        if (currentTime >= this.nextFoodTime) {
            // Zaman doldu (5 saniyelik ömür bitti), yeni yemi spawn et ve zamanlayıcıyı sıfırla
            this.food.spawn(this.snake.body);
            this.resetFoodTimer();
            remainingTime = FOOD_COOLDOWN_MS; // Yeni döngü başladı
            playTone(200, 0.05, 'square'); // Cooldown bitiş sesi
        }
        
        // Zamanlayıcıyı güncelle
        const seconds = (remainingTime / 1000).toFixed(1);
        foodTimerDisplay.textContent = `Yem Süresi: ${seconds}s`;
        
        // Son 2 saniyede renk uyarısı
        if (remainingTime < 2000) { 
            foodTimerDisplay.classList.add('text-red-500');
            foodTimerDisplay.classList.remove('text-blue-400');
        } else {
            foodTimerDisplay.classList.remove('text-red-500');
            foodTimerDisplay.classList.add('text-blue-400');
        }
    }

    // Hızlanma Maliyeti
    handleDashCost() {
        // Dash sadece yeterli yılan uzunluğu varsa aktif olur
        if (this.isDashing) {
            this.dashCostTimer++;
            dashFill.style.width = `${(1 - (this.dashCostTimer / this.maxDashCost)) * 100}%`;
            
            if (this.dashCostTimer >= this.maxDashCost) { 
                if (this.snake.body.length > 3) {
                    this.snake.body.pop(); 
                    this.dashCostTimer = 0;
                    playTone(150, 0.05, 'triangle'); 
                } else {
                    this.isDashing = false; // Yılan çok kısaysa dash'i durdur
                }
            }
        } else {
            // Dash'ten çıkınca veya Dash aktif değilken çubuğu doldur
            this.dashCostTimer = 0;
            dashFill.style.width = '100%';
        }
    }
    
    // Güçlendirme Süresini Kontrol Et
    checkPowerupExpiration() {
        if (this.activePowerup.type && performance.now() >= this.activePowerup.endTime) {
            this.activePowerup = { type: null, endTime: 0 };
            activePowerupDisplay.textContent = '';
        } else if (this.activePowerup.type) {
             const remaining = Math.ceil((this.activePowerup.endTime - performance.now()) / 1000);
             activePowerupDisplay.textContent = `${this.activePowerup.type} (${remaining}s)`;
        }
    }

    // Skor İle Hız Artışı
    checkSpeedIncrease() {
        // Not: Bu kontrol sadece pozitif skorlu yiyecek yendiğinde çağrılır.
        if (this.score % SPEED_INCREASE_INTERVAL === 0 && this.score > 0 && this.gameSpeed > MIN_GAME_SPEED) {
            this.gameSpeed -= 5; 
            playTone(600, 0.05, 'square'); 
        }
    }

    // Çarpışma Kontrolü
    checkCollision(head) {
        const isInvincible = this.activePowerup.type === 'INVINCIBLE';
        
        // Duvarlara çarpma (Moda bağlı)
        if (this.gameMode === 'HARDCORE') {
            if (head.x < 0 || head.x >= CANVAS_WIDTH || head.y < 0 || head.y >= CANVAS_HEIGHT) {
                return !isInvincible;
            }
        } else { // Klasik Mod (Sınırlardan Geçiş)
            if (head.x < 0) head.x = CANVAS_WIDTH - TILE_SIZE;
            else if (head.x >= CANVAS_WIDTH) head.x = 0;
            else if (head.y < 0) head.y = CANVAS_HEIGHT - TILE_SIZE;
            else if (head.y >= CANVAS_HEIGHT) head.y = 0;
            // Güncellenen kafa pozisyonunu yılanın gövdesine yansıt
            this.snake.body[0].x = head.x;
            this.snake.body[0].y = head.y;
        }

        // Kendi kuyruğuna çarpma
        for (let i = 1; i < this.snake.body.length; i++) {
            if (head.x === this.snake.body[i].x && head.y === this.snake.body[i].y) {
                return !isInvincible;
            }
        }
        
        return false;
    }
    
    // Oyun Bitti
    async gameOver() {
        this.isRunning = false;
        playTone(70, 0.5, 'square'); 
        messageTitle.textContent = "Oyun Bitti! 🐍💥";
        messageText.textContent = `${this.playerName}, Muhteşem Puanınız: ${this.score}. En Yüksek: ${this.highScore}`;
        
        messageBox.style.display = 'flex'; // Game Over ekranını göster
        geminiButton.disabled = !apiKey; // API anahtarı yoksa düğmeyi devre dışı bırak
        mobileControls.style.display = 'none'; // Mobil kontrolleri gizle
        
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
        
        // Yeni skorun kaydedilmesi
        await this.recordScore(); 
    }
    
    /**
     * Skoru Firestore'a kaydeder.
     */
    async recordScore() {
        if (this.score <= 0) return; // Negatif veya sıfır skorları kaydetme
        
        try {
            const fns = await getFirestoreFunctions();
            // Firebase DB objesi varsa devam et
            if (!fns || !fns.db || !window.currentUserId) {
                console.error("Firestore fonksiyonları veya kullanıcı ID'si mevcut değil. Skor kaydedilemedi.");
                return;
            }

            const { db, collection, addDoc, serverTimestamp } = fns;
            
            // HTML'den global olarak tanımlanan APP_ID ve currentUserId kullanılır.
            const collectionPath = `/artifacts/${APP_ID}/public/data/snake_leaderboard`; 
            
            await addDoc(collection(db, collectionPath), {
                playerName: this.playerName,
                score: this.score,
                userId: window.currentUserId, // HTML'de global olarak set edildi
                timestamp: serverTimestamp(),
            });
            
            console.log("Skor başarıyla Firestore'a kaydedildi:", this.score);
        } catch (error) {
            console.error("Skor Firestore'a kaydedilirken hata oluştu:", error);
            // Kullanıcıya görünür bir hata mesajı vermek için buraya bir UI kodu eklenebilir.
        }
    }


    // Skoru Güncelle
    updateScoreDisplay() {
        scoreDisplay.textContent = `Puan: ${this.score}`;
        if (this.score > this.highScore) {
            this.highScore = this.score;
            localStorage.setItem('snakeHighScore', this.highScore);
        }
        highScoreDisplay.textContent = `En Yüksek: ${this.highScore}`;
    }

    // Canvas'a Çizim Yap
    draw(updateSpeed, interpolationTime) {
        ctx.fillStyle = '#ffffff'; 
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        if (!this.snake || !this.food) return;

        // Interpolasyon Faktörü
        let lerpFactor = 0;
        if (this.isRunning && !this.isPaused) {
            lerpFactor = interpolationTime / updateSpeed;
        } else if (this.isRunning) {
            lerpFactor = 0; // Duraklatılmışsa hareket etme
        } else {
            lerpFactor = 1; 
        }

        // Yemi Çiz
        const foodProps = FOOD_TYPES[this.food.type];
        
        ctx.fillStyle = foodProps.color;
        // Yiyeceği parlaklık ekleyerek çiz
        ctx.shadowColor = foodProps.color;
        ctx.shadowBlur = 10;
        ctx.fillRect(this.food.position.x + 2, this.food.position.y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        ctx.shadowBlur = 0;

        // Yılanı Çiz
        const snake = this.snake.body;
        const prevSegments = this.snake.prevSegments;

        for (let i = 1; i < snake.length; i++) {
            let x, y;
            let prevX = (i < prevSegments.length) ? prevSegments[i].x : snake[i].x;
            let prevY = (i < prevSegments.length) ? prevSegments[i].y : snake[i].y;

            if (this.isRunning && !this.isPaused) {
                x = prevX + (snake[i].x - prevX) * lerpFactor;
                y = prevY + (snake[i].y - prevY) * lerpFactor;
            } else {
                x = snake[i].x;
                y = snake[i].y;
            }

            const hue = 140; 
            const saturation = 100;
            const lightness = 40 + (i / snake.length) * 20; 
            ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
            // Vücut segmentlerini birleşik çiz
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }

        // Kafa segmentini en son çiz (her zaman en üstte)
        let headX, headY;
        let prevHeadX = prevSegments[0].x;
        let prevHeadY = prevSegments[0].y;
        
        if (this.isRunning && !this.isPaused) {
            headX = prevHeadX + (snake[0].x - prevHeadX) * lerpFactor;
            headY = prevHeadY + (snake[0].y - prevHeadY) * lerpFactor;
        } else {
            headX = snake[0].x;
            headY = snake[0].y;
        }
        
        ctx.fillStyle = this.activePowerup.type === 'INVINCIBLE' ? '#ecc94b' : (this.isDashing ? '#f6ad55' : '#38a169'); 
        
        // Vücut köşelerini yuvarlatmak için hafifçe içeri çekerek çizim yap
        ctx.fillRect(headX, headY, TILE_SIZE, TILE_SIZE);

        // Gözler (Başın yeni pozisyonuna göre çizilir)
        ctx.fillStyle = 'white';
        ctx.fillRect(headX + 4, headY + 4, 3, 3);
        ctx.fillRect(headX + TILE_SIZE - 7, headY + 4, 3, 3);
    }
}

// --- ANA OYUN NESNESİ VE OLAY YÖNETİMİ ---
const game = new Game();
let touchStartX = 0;
let touchStartY = 0;

startButton.addEventListener('click', () => game.initialize());
// Game Over butonu
restartButtonGameOver.addEventListener('click', () => game.initialize());
// Oyun sırasında görünür olan yeni buton
restartButtonInGame.addEventListener('click', () => {
    // Kullanıcıya yeniden başlatmayı onaylatmak için özel bir modal/uyarı kutusu kullanın
    const isConfirmed = window.confirm ? window.confirm("Mevcut oyunu bırakıp yeniden başlatmak istediğinizden emin misiniz?") : true;

    if (isConfirmed) {
        game.initialize();
    }
});
geminiButton.addEventListener('click', () => generateCommentary(game.score, game.highScore, game.playerName));
mobilePauseButton.addEventListener('click', () => game.togglePause()); // YENİ: Mobil Pause

// --- MOBİL BUTON KONTROLLERİ ---
const btnUp = document.getElementById('btn-up');
const btnDown = document.getElementById('btn-down');
const btnLeft = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');
const btnDash = document.getElementById('btn-dash');

// Yön butonlarına tıklama (veya dokunma) olaylarını ekle
btnUp.addEventListener('click', () => {
    if (game.isRunning && !game.isPaused) game.snake.changeDirection(0, -TILE_SIZE);
});
btnDown.addEventListener('click', () => {
    if (game.isRunning && !game.isPaused) game.snake.changeDirection(0, TILE_SIZE);
});
btnLeft.addEventListener('click', () => {
    if (game.isRunning && !game.isPaused) game.snake.changeDirection(-TILE_SIZE, 0);
});
btnRight.addEventListener('click', () => {
    if (game.isRunning && !game.isPaused) game.snake.changeDirection(TILE_SIZE, 0);
});

// Dash butonuna basma/bırakma olaylarını ekle
btnDash.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Varsayılan davranışı engelle (kaydırma vb.)
    if (game.isRunning && !game.isPaused) game.isDashing = true;
}, { passive: false }); // Passive: false, preventDefault'un çalışması için önemli
btnDash.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (game.isRunning && !game.isPaused) game.isDashing = false;
}, { passive: false });

// Masaüstü testleri için mouse olaylarını da ekleyelim
btnDash.addEventListener('mousedown', () => {
    if (game.isRunning && !game.isPaused) game.isDashing = true;
});
btnDash.addEventListener('mouseup', () => {
    if (game.isRunning && !game.isPaused) game.isDashing = false;
});
// --- MOBİL BUTON KONTROLLERİ SONU ---


// Klavye Girişi Yönetimi
document.addEventListener('keydown', (e) => {
    // Oyuncu adı giriş alanına odaklanılmışsa sadece boşluk tuşunu işle
    if (document.activeElement === playerNameInput) {
        if (e.key === ' ') { 
            e.preventDefault(); 
            game.isDashing = true;
        }
        return; 
    }
    
    // Pause Kontrolü 
    if (e.key === 'p' || e.key === 'P') {
        if (game.isRunning) {
            game.togglePause();
        }
        return;
    }
    
    if (!game.isRunning || game.isPaused) return;

    const keyPressed = e.key;
    let newDx = game.snake.dx;
    let newDy = game.snake.dy;

    switch (keyPressed) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
            newDx = -TILE_SIZE;
            newDy = 0;
            break;
        case 'ArrowUp':
        case 'w':
        case 'W':
            newDx = 0;
            newDy = -TILE_SIZE;
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            newDx = TILE_SIZE;
            newDy = 0;
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            newDx = 0;
            newDy = TILE_SIZE;
            break;
        case ' ': 
            e.preventDefault();
            game.isDashing = true;
            return; 
        default:
            return;
    }
    
    game.snake.changeDirection(newDx, newDy);
});

document.addEventListener('keyup', (e) => {
    if (!game.isRunning || game.isPaused) return;
    if (e.key === ' ') {
        game.isDashing = false;
    }
});

// --- MOBİL (TOUCH) KONTROLLER (Canvas üzerindeki eski kaydırmayı devre dışı bırakıyoruz) ---
// Not: Artık butonlar olduğu için canvas üzerindeki kaydırma hareketlerini kullanmaya gerek yok.
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Varsayılan kaydırma davranışını tamamen engelle
}, { passive: false }); 

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
}, { passive: false });


// --- OYUN BAŞLANGICI ---
// Elmanın yüklenmesini bekleyelim ve yüklendikten sonra ilk çizimi yapalım.
appleImage.onload = () => {
    // Oyun menüsü görünürken bir kez ilk çizimi yap
    game.draw(0, 0); 
};

// Yükleme tamamlanmadıysa, yine de menüye geç
if (!appleImage.complete) {
    game.draw(0, 0);
}
