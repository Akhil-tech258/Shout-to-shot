(function() {
    // ─────────────────────────────────────
    // DOM ELEMENTS
    // ─────────────────────────────────────
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const volumeBarFill = document.getElementById('volume-bar-fill');
    const volumeLabel = document.getElementById('volume-label');
    const micErrorEl = document.getElementById('mic-error');
    const wrapper = document.getElementById('game-wrapper');

    // ─────────────────────────────────────
    // CANVAS SETUP
    // ─────────────────────────────────────
    const INTERNAL_W = 960;
    const INTERNAL_H = 540;
    canvas.width = INTERNAL_W;
    canvas.height = INTERNAL_H;

    function resizeCanvas() {
        const wrapperW = wrapper.clientWidth;
        const wrapperH = wrapper.clientHeight;
        const aspect = INTERNAL_W / INTERNAL_H;
        let displayW, displayH;
        if (wrapperW / wrapperH > aspect) {
            displayH = Math.min(wrapperH, window.innerHeight - 20);
            displayW = displayH * aspect;
        } else {
            displayW = Math.min(wrapperW, window.innerWidth - 20);
            displayH = displayW / aspect;
        }
        canvas.style.width = displayW + 'px';
        canvas.style.height = displayH + 'px';
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // ─────────────────────────────────────
    // AUDIO SYSTEM (Web Audio API - no external APIs)
    // ─────────────────────────────────────
    let audioCtx = null;
    let analyser = null;
    let micStream = null;
    let smoothedVolume = 0;
    let rawVolume = 0;
    let micActive = false;
    let volumeHistory = [];
    const VOLUME_SMOOTH = 0.18;
    const VOLUME_HISTORY_SIZE = 12;

    async function requestMicrophone() {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                }
            });
            audioCtx = new(window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.3;
            const source = audioCtx.createMediaStreamSource(micStream);
            source.connect(analyser);
            micActive = true;
            micErrorEl.style.display = 'none';
            console.log('🎤 Microphone activated!');
        } catch (err) {
            console.warn('Microphone error:', err);
            micActive = false;
            micErrorEl.style.display = 'block';
        }
    }

    let micSensitivity = parseFloat(localStorage.getItem('shout_runner_sens') || '8.5');
    let keyboardSimulatedVolume = 0;

    const micSensSlider = document.getElementById('micSensSlider');
    const sensValue = document.getElementById('sensValue');
    if (micSensSlider && sensValue) {
        micSensSlider.value = micSensitivity;
        sensValue.textContent = micSensitivity + 'x';
        micSensSlider.addEventListener('input', () => {
            micSensitivity = parseFloat(micSensSlider.value);
            sensValue.textContent = micSensitivity + 'x';
            localStorage.setItem('shout_runner_sens', micSensitivity);
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.key === 'ArrowUp') {
            keyboardSimulatedVolume = 0.88;
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' || e.key === 'ArrowUp') {
            keyboardSimulatedVolume = 0;
        }
    });

    function getMicVolume() {
        if (keyboardSimulatedVolume > 0) return keyboardSimulatedVolume;
        if (!analyser || !micActive) return 0;
        const dataArray = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const amplified = Math.min(1, rms * micSensitivity);
        return amplified;
    }

    function updateVolume() {
        rawVolume = getMicVolume();
        smoothedVolume = smoothedVolume * (1 - VOLUME_SMOOTH) + rawVolume * VOLUME_SMOOTH;
        volumeHistory.push(smoothedVolume);
        if (volumeHistory.length > VOLUME_HISTORY_SIZE) volumeHistory.shift();
        const volPercent = Math.round(smoothedVolume * 100);
        volumeBarFill.style.width = volPercent + '%';
        if (volPercent < 15) volumeBarFill.style.background = '#4ef08e';
        else if (volPercent < 40) volumeBarFill.style.background = '#ffb347';
        else if (volPercent < 70) volumeBarFill.style.background = '#ff7b42';
        else volumeBarFill.style.background = '#ff3860';
    }

    // ─────────────────────────────────────
    // GAME STATE
    // ─────────────────────────────────────
    const STATE = {
        START: 'start',
        MIC_WAIT: 'mic_wait',
        PLAYING: 'playing',
        BOSS_WARNING: 'boss_warning',
        BOSS_FIGHT: 'boss_fight',
        LEVEL_COMPLETE: 'level_complete',
        GAME_OVER: 'game_over',
        VICTORY: 'victory',
    };

    let gameState = STATE.START;
    let currentLevel = 1;
    let score = 0;
    let coins = 0;
    let distanceTraveled = 0;
    let survivalTime = 0;
    let levelDistanceGoal = 0;
    let levelStartDistance = 0;
    let bossDefeated = false;
    let bossHealth = 0;
    let bossMaxHealth = 0;
    let shakeAmount = 0;
    let shakeDecay = 0.85;
    let particles = [];
    let floatingTexts = [];
    let powerUpActive = null;
    let powerUpTimer = 0;
    let silenceModeActive = false;
    let silenceTimer = 0;
    let worldSpeed = 3.5;
    let baseWorldSpeed = 3.5;
    let speedBoostTimer = 0;
    let levelMessage = '';
    let levelMessageTimer = 0;
    let bossWarningTimer = 0;
    let frameCount = 0;

    // Player object
    const player = {
        x: 150,
        y: 400,
        width: 28,
        height: 44,
        vy: 0,
        grounded: true,
        groundY: 400,
        jumpPower: -7.5,
        doubleJumpAvailable: true,
        animFrame: 0,
        panic: 0,
    };

    // Obstacles
    let obstacles = [];
    let powerUps = [];
    let bossAttacks = [];
    let bossEntity = null;

    // ─────────────────────────────────────
    // LEVEL DEFINITIONS (1-20)
    // ─────────────────────────────────────
    function getLevelConfig(level) {
        let config = {
            speed: 3.5,
            distanceGoal: 800,
            environment: 'grass',
            obstaclesRate: 0.02,
            boss: false,
            bossName: '',
            special: null,
        };
        if (level <= 5) {
            config.environment = 'grass';
            config.speed = 2.8 + level * 0.3;
            config.distanceGoal = 700 + level * 50;
            config.obstaclesRate = 0.015 + level * 0.005;
            if (level === 5) config.boss = true, config.bossName = 'Noise Guardian';
        } else if (level <= 10) {
            config.environment = level % 2 === 0 ? 'desert' : 'grass';
            config.speed = 4.0 + (level - 5) * 0.4;
            config.distanceGoal = 900 + (level - 5) * 60;
            config.obstaclesRate = 0.025 + (level - 5) * 0.008;
            if (level === 10) config.boss = true, config.bossName = 'Echo Machine';
        } else if (level <= 15) {
            config.environment = level % 2 === 0 ? 'ice' : 'lava';
            config.speed = 5.0 + (level - 10) * 0.5;
            config.distanceGoal = 1000 + (level - 10) * 70;
            config.obstaclesRate = 0.035 + (level - 10) * 0.01;
            if (level === 15) config.boss = true, config.bossName = 'Volcano Beast';
        } else if (level <= 19) {
            config.environment = 'chaos';
            config.speed = 6.5 + (level - 15) * 0.6;
            config.distanceGoal = 1100 + (level - 15) * 80;
            config.obstaclesRate = 0.05 + (level - 15) * 0.015;
        } else if (level === 20) {
            config.environment = 'final';
            config.speed = 7.5;
            config.distanceGoal = 1500;
            config.obstaclesRate = 0.08;
            config.boss = true;
            config.bossName = 'Audio King';
        }
        return config;
    }

    // ─────────────────────────────────────
    // HELPER: GET INPUT ACTION BASED ON VOLUME
    // ─────────────────────────────────────
    function getVoiceAction() {
        const vol = smoothedVolume;
        if (silenceModeActive) {
            return { action: 'run', intensity: 0.3 };
        }
        if (vol < 0.08) return { action: 'idle', intensity: vol };
        if (vol < 0.2) return { action: 'walk', intensity: vol };
        if (vol < 0.45) return { action: 'run', intensity: vol };
        if (vol < 0.7) return { action: 'jump', intensity: vol };
        if (vol < 0.9) return { action: 'super_jump', intensity: vol };
        return { action: 'shout', intensity: vol };
    }

    // ─────────────────────────────────────
    // GAME FUNCTIONS
    // ─────────────────────────────────────
    function startGame() {
        currentLevel = 1;
        score = 0;
        coins = 0;
        distanceTraveled = 0;
        survivalTime = 0;
        resetPlayer();
        obstacles = [];
        powerUps = [];
        bossAttacks = [];
        bossEntity = null;
        bossDefeated = false;
        powerUpActive = null;
        powerUpTimer = 0;
        silenceModeActive = false;
        silenceTimer = 0;
        speedBoostTimer = 0;
        worldSpeed = baseWorldSpeed;
        const config = getLevelConfig(currentLevel);
        baseWorldSpeed = config.speed;
        worldSpeed = baseWorldSpeed;
        levelDistanceGoal = config.distanceGoal;
        levelStartDistance = 0;
        if (config.boss) {
            gameState = STATE.BOSS_WARNING;
            bossWarningTimer = 120;
            bossMaxHealth = 5 + currentLevel * 2;
            bossHealth = bossMaxHealth;
        } else {
            gameState = STATE.PLAYING;
        }
    }

    function resetPlayer() {
        player.x = 150;
        player.y = player.groundY;
        player.vy = 0;
        player.grounded = true;
        player.doubleJumpAvailable = true;
        player.animFrame = 0;
        player.panic = 0;
    }

    function restartFromGameOver() {
        startGame();
    }

    function levelComplete() {
        if (currentLevel >= 20) {
            gameState = STATE.VICTORY;
            return;
        }
        currentLevel++;
        const config = getLevelConfig(currentLevel);
        baseWorldSpeed = config.speed;
        worldSpeed = baseWorldSpeed;
        levelDistanceGoal = config.distanceGoal;
        levelStartDistance = distanceTraveled;
        obstacles = [];
        powerUps = [];
        bossAttacks = [];
        bossEntity = null;
        bossDefeated = false;
        powerUpActive = null;
        powerUpTimer = 0;
        silenceModeActive = false;
        silenceTimer = 0;
        speedBoostTimer = 0;
        resetPlayer();
        if (config.boss) {
            gameState = STATE.BOSS_WARNING;
            bossWarningTimer = 120;
            bossMaxHealth = 5 + currentLevel * 2;
            bossHealth = bossMaxHealth;
        } else {
            gameState = STATE.PLAYING;
        }
    }

    function spawnObstacle() {
        const config = getLevelConfig(currentLevel);
        const types = ['spike', 'gap', 'wall', 'falling'];
        if (config.environment === 'lava') types.push('lava');
        if (config.environment === 'ice') types.push('ice_block');
        const type = types[Math.floor(Math.random() * types.length)];
        let obs = {
            x: INTERNAL_W + 50,
            y: player.groundY,
            width: 30,
            height: 40,
            type: type,
            speed: worldSpeed,
            passed: false,
        };
        if (type === 'gap') {
            obs.y = player.groundY + 20;
            obs.width = 60;
            obs.height = 20;
        } else if (type === 'wall') {
            obs.y = player.groundY - 40;
            obs.width = 25;
            obs.height = 80;
        } else if (type === 'falling') {
            obs.y = -50;
            obs.vy = worldSpeed * 1.2;
        } else if (type === 'lava') {
            obs.y = player.groundY - 10;
            obs.width = 50;
            obs.height = 30;
        } else if (type === 'ice_block') {
            obs.y = player.groundY - 15;
            obs.width = 40;
            obs.height = 35;
        }
        obstacles.push(obs);
    }

    function spawnPowerUp() {
        if (powerUpActive) return;
        const types = ['amplifier', 'shield', 'speed', 'silence'];
        const type = types[Math.floor(Math.random() * types.length)];
        powerUps.push({
            x: INTERNAL_W + 80,
            y: player.groundY - 25,
            width: 20,
            height: 20,
            type: type,
            speed: worldSpeed,
        });
    }

    function activatePowerUp(type) {
        powerUpActive = type;
        powerUpTimer = 300; // ~5 seconds at 60fps
        if (type === 'amplifier') {
            player.jumpPower = -9;
        } else if (type === 'shield') {
            // handled in collision
        } else if (type === 'speed') {
            speedBoostTimer = 180;
            worldSpeed = baseWorldSpeed * 1.5;
        } else if (type === 'silence') {
            silenceModeActive = true;
            silenceTimer = 240;
        }
    }

    function deactivatePowerUp() {
        if (powerUpActive === 'amplifier') player.jumpPower = -7.5;
        if (powerUpActive === 'speed') {
            worldSpeed = baseWorldSpeed;
            speedBoostTimer = 0;
        }
        if (powerUpActive === 'silence') silenceModeActive = false;
        powerUpActive = null;
        powerUpTimer = 0;
    }

    function handleCollisions() {
        const px = player.x;
        const py = player.y;
        const pw = player.width;
        const ph = player.height;

        // Obstacles
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const obs = obstacles[i];
            if (px < obs.x + obs.width && px + pw > obs.x && py < obs.y + obs.height && py + ph > obs.y) {
                if (powerUpActive === 'shield') {
                    obstacles.splice(i, 1);
                    deactivatePowerUp();
                    floatingTexts.push({ x: player.x, y: player.y - 20, text: '🛡️ Shield!', timer: 40 });
                    continue;
                }
                gameOver();
                return;
            }
        }

        // Power-ups
        for (let i = powerUps.length - 1; i >= 0; i--) {
            const pu = powerUps[i];
            if (px < pu.x + pu.width && px + pw > pu.x && py < pu.y + pu.height && py + ph > pu.y) {
                activatePowerUp(pu.type);
                powerUps.splice(i, 1);
                floatingTexts.push({ x: player.x, y: player.y - 30, text: '⚡' + pu.type, timer: 40 });
            }
        }

        // Boss attacks (only in boss fight)
        if (gameState === STATE.BOSS_FIGHT && bossEntity) {
            for (let i = bossAttacks.length - 1; i >= 0; i--) {
                const atk = bossAttacks[i];
                if (px < atk.x + atk.width && px + pw > atk.x && py < atk.y + atk.height && py + ph > atk.y) {
                    if (powerUpActive === 'shield') {
                        bossAttacks.splice(i, 1);
                        deactivatePowerUp();
                        continue;
                    }
                    gameOver();
                    return;
                }
            }
        }
    }

    function gameOver() {
        gameState = STATE.GAME_OVER;
        shakeAmount = 15;
    }

    function updateBoss() {
        if (gameState !== STATE.BOSS_FIGHT || !bossEntity) return;
        // Boss movement
        bossEntity.x -= worldSpeed * 0.3;
        if (bossEntity.x < -100) bossEntity.x = INTERNAL_W + 100;

        // Boss attacks
        if (frameCount % 90 === 0) {
            bossAttacks.push({
                x: bossEntity.x,
                y: player.groundY - 30,
                width: 30,
                height: 30,
                speed: worldSpeed * 1.4,
            });
        }
        if (frameCount % 150 === 0 && currentLevel >= 15) {
            // shockwave
            bossAttacks.push({
                x: bossEntity.x - 40,
                y: player.groundY,
                width: 80,
                height: 20,
                speed: worldSpeed * 1.2,
            });
        }

        // Move attacks
        for (let i = bossAttacks.length - 1; i >= 0; i--) {
            bossAttacks[i].x -= bossAttacks[i].speed;
            if (bossAttacks[i].x < -80) bossAttacks.splice(i, 1);
        }

        // Check if player voice damages boss (shout action)
        const action = getVoiceAction();
        if (action.action === 'shout' && player.grounded) {
            bossHealth -= 0.25;
            floatingTexts.push({ x: bossEntity.x, y: bossEntity.y - 20, text: '🗣️', timer: 20 });
            shakeAmount = Math.max(shakeAmount, 5);
        }
        if (bossHealth <= 0) {
            bossDefeated = true;
            gameState = STATE.LEVEL_COMPLETE;
            floatingTexts.push({ x: INTERNAL_W / 2, y: 200, text: 'BOSS DEFEATED!', timer: 80 });
            score += 1000;
        }
    }

    function update() {
        if (gameState === STATE.START || gameState === STATE.MIC_WAIT) return;
        if (gameState === STATE.BOSS_WARNING) {
            bossWarningTimer--;
            if (bossWarningTimer <= 0) {
                gameState = STATE.BOSS_FIGHT;
                bossEntity = {
                    x: INTERNAL_W - 150,
                    y: player.groundY - 60,
                    width: 60,
                    height: 80,
                };
            }
            return;
        }

        frameCount++;
        survivalTime += 1 / 60;

        // Speed boost timer
        if (speedBoostTimer > 0) {
            speedBoostTimer--;
            if (speedBoostTimer <= 0) worldSpeed = baseWorldSpeed;
        }

        // Silence timer
        if (silenceModeActive) {
            silenceTimer--;
            if (silenceTimer <= 0) silenceModeActive = false;
        }

        // Power-up timer
        if (powerUpActive) {
            powerUpTimer--;
            if (powerUpTimer <= 0) deactivatePowerUp();
        }

        // Voice action
        const action = getVoiceAction();
        const vol = smoothedVolume;

        // Player movement based on action
        if (action.action === 'idle' || action.action === 'walk') {
            worldSpeed = baseWorldSpeed * 0.6;
        } else if (action.action === 'run') {
            worldSpeed = baseWorldSpeed;
        } else if (action.action === 'jump' || action.action === 'super_jump') {
            worldSpeed = baseWorldSpeed;
            if (player.grounded) {
                player.vy = action.action === 'super_jump' ? player.jumpPower * 1.4 : player.jumpPower;
                player.grounded = false;
                player.doubleJumpAvailable = true;
            } else if (player.doubleJumpAvailable && action.action === 'super_jump') {
                player.vy = player.jumpPower * 1.2;
                player.doubleJumpAvailable = false;
                floatingTexts.push({ x: player.x, y: player.y - 15, text: '🦘 Double!', timer: 30 });
            }
        } else if (action.action === 'shout') {
            worldSpeed = baseWorldSpeed * 1.15;
            if (player.grounded) {
                player.vy = player.jumpPower * 1.7;
                player.grounded = false;
                shakeAmount = 8;
            }
        }

        // Gravity and ground
        player.vy += 0.55;
        player.y += player.vy;
        if (player.y >= player.groundY) {
            player.y = player.groundY;
            player.vy = 0;
            player.grounded = true;
            player.doubleJumpAvailable = true;
        }

        // Move world (distance)
        distanceTraveled += worldSpeed * 0.1;
        score = Math.floor(distanceTraveled) + coins * 10;

        // Obstacle spawning
        const config = getLevelConfig(currentLevel);
        if (Math.random() < config.obstaclesRate && obstacles.length < 6) spawnObstacle();
        if (Math.random() < 0.008 && powerUps.length < 2) spawnPowerUp();

        // Move obstacles and power-ups
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const obs = obstacles[i];
            if (obs.type === 'falling') {
                obs.vy += 0.3;
                obs.y += obs.vy;
            } else {
                obs.x -= worldSpeed;
            }
            if (obs.x < -100 || obs.y > INTERNAL_H + 100) {
                if (!obs.passed && obs.x < player.x) {
                    coins += 1;
                    obs.passed = true;
                }
                obstacles.splice(i, 1);
            }
        }

        for (let i = powerUps.length - 1; i >= 0; i--) {
            powerUps[i].x -= worldSpeed;
            if (powerUps[i].x < -50) powerUps.splice(i, 1);
        }

        // Boss update
        updateBoss();

        // Collision
        handleCollisions();

        // Level progression (non-boss)
        if (gameState === STATE.PLAYING && distanceTraveled - levelStartDistance >= levelDistanceGoal) {
            gameState = STATE.LEVEL_COMPLETE;
            levelComplete();
        }

        // Shake decay
        shakeAmount *= shakeDecay;
        if (shakeAmount < 0.1) shakeAmount = 0;

        // Floating texts
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            floatingTexts[i].timer--;
            if (floatingTexts[i].timer <= 0) floatingTexts.splice(i, 1);
        }

        updateVolume();
    }

    // ─────────────────────────────────────
    // RENDERING
    // ─────────────────────────────────────
    function drawBackground() {
        const config = getLevelConfig(currentLevel);
        let grad;
        if (config.environment === 'grass') {
            grad = ctx.createLinearGradient(0, 0, 0, INTERNAL_H);
            grad.addColorStop(0, '#87CEEB');
            grad.addColorStop(1, '#228B22');
        } else if (config.environment === 'desert') {
            grad = ctx.createLinearGradient(0, 0, 0, INTERNAL_H);
            grad.addColorStop(0, '#FFDAB9');
            grad.addColorStop(1, '#D2B48C');
        } else if (config.environment === 'ice') {
            grad = ctx.createLinearGradient(0, 0, 0, INTERNAL_H);
            grad.addColorStop(0, '#E0FFFF');
            grad.addColorStop(1, '#ADD8E6');
        } else if (config.environment === 'lava') {
            grad = ctx.createLinearGradient(0, 0, 0, INTERNAL_H);
            grad.addColorStop(0, '#8B0000');
            grad.addColorStop(1, '#FF4500');
        } else if (config.environment === 'chaos') {
            grad = ctx.createLinearGradient(0, 0, 0, INTERNAL_H);
            grad.addColorStop(0, '#4B0082');
            grad.addColorStop(1, '#9400D3');
        } else if (config.environment === 'final') {
            grad = ctx.createLinearGradient(0, 0, 0, INTERNAL_H);
            grad.addColorStop(0, '#000000');
            grad.addColorStop(1, '#2F0B3A');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
        // ground line
        ctx.fillStyle = '#3a2e1e';
        ctx.fillRect(0, player.groundY + 15, INTERNAL_W, 20);
    }

    function drawPlayer() {
        ctx.save();
        ctx.translate(player.x, player.y);
        if (player.panic > 0) {
            ctx.rotate(Math.sin(frameCount * 0.5) * 0.2);
        }
        // body
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(-player.width / 2, -player.height, player.width, player.height);
        // eyes
        ctx.fillStyle = '#000';
        ctx.fillRect(-8, -player.height + 8, 4, 4);
        ctx.fillRect(4, -player.height + 8, 4, 4);
        // legs animation
        if (!player.grounded) {
            ctx.fillStyle = '#B8860B';
            ctx.fillRect(-10, -4, 6, 8);
            ctx.fillRect(4, -4, 6, 8);
        }
        ctx.restore();
    }

    function drawObstacles() {
        for (let obs of obstacles) {
            ctx.save();
            ctx.translate(obs.x, obs.y);
            if (obs.type === 'spike') {
                ctx.fillStyle = '#888';
                ctx.beginPath();
                ctx.moveTo(-15, 0);
                ctx.lineTo(0, -30);
                ctx.lineTo(15, 0);
                ctx.fill();
            } else if (obs.type === 'gap') {
                ctx.fillStyle = '#000';
                ctx.fillRect(-30, -10, 60, 20);
            } else if (obs.type === 'wall') {
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(-12, -40, 25, 80);
            } else if (obs.type === 'falling') {
                ctx.fillStyle = '#A9A9A9';
                ctx.fillRect(-15, -15, 30, 30);
            } else if (obs.type === 'lava') {
                ctx.fillStyle = '#FF4500';
                ctx.fillRect(-25, -10, 50, 30);
            } else if (obs.type === 'ice_block') {
                ctx.fillStyle = '#AFEEEE';
                ctx.fillRect(-20, -15, 40, 35);
            }
            ctx.restore();
        }
    }

    function drawPowerUps() {
        for (let pu of powerUps) {
            ctx.fillStyle = pu.type === 'amplifier' ? '#FF69B4' :
                pu.type === 'shield' ? '#00CED1' :
                pu.type === 'speed' ? '#FFD700' : '#BA55D3';
            ctx.beginPath();
            ctx.arc(pu.x, pu.y, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#FFF';
            ctx.font = '10px sans-serif';
            ctx.fillText(pu.type[0].toUpperCase(), pu.x - 4, pu.y + 3);
        }
    }

    function drawBoss() {
        if (!bossEntity) return;
        ctx.fillStyle = '#DC143C';
        ctx.fillRect(bossEntity.x - 30, bossEntity.y - 40, 60, 80);
        ctx.fillStyle = '#FFF';
        ctx.fillRect(bossEntity.x - 15, bossEntity.y - 30, 10, 10);
        ctx.fillRect(bossEntity.x + 5, bossEntity.y - 30, 10, 10);
        // health bar
        const healthPercent = bossHealth / bossMaxHealth;
        ctx.fillStyle = '#333';
        ctx.fillRect(bossEntity.x - 40, bossEntity.y - 55, 80, 8);
        ctx.fillStyle = '#ff5e7a';
        ctx.fillRect(bossEntity.x - 40, bossEntity.y - 55, 80 * healthPercent, 8);
    }

    function drawBossAttacks() {
        ctx.fillStyle = '#FF0000';
        for (let atk of bossAttacks) {
            ctx.fillRect(atk.x - 15, atk.y - 10, 30, 20);
        }
    }

    function drawUI() {
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 18px "Segoe UI"';
        ctx.fillText(`Level ${currentLevel}`, 20, 40);
        ctx.fillText(`Score: ${score}`, 20, 70);
        ctx.fillText(`Coins: ${coins}`, 20, 100);
        if (powerUpActive) {
            ctx.fillStyle = '#FFD700';
            ctx.fillText(`⚡ ${powerUpActive}`, 20, 130);
        }
        if (silenceModeActive) {
            ctx.fillText('🔇 Silence', 20, 160);
        }
        // Volume hint
        const volHint = smoothedVolume < 0.1 ? 'Whisper...' :
            smoothedVolume < 0.35 ? 'Talk' : smoothedVolume < 0.65 ? 'Yell!' : 'SHOUT!!';
        ctx.fillStyle = '#ccc';
        ctx.font = '14px sans-serif';
        ctx.fillText(`🎤: ${volHint}`, INTERNAL_W - 120, 35);
    }

    function drawMessages() {
        if (levelMessageTimer > 0) {
            ctx.fillStyle = '#FFF';
            ctx.font = '24px sans-serif';
            ctx.fillText(levelMessage, INTERNAL_W / 2 - 100, INTERNAL_H / 2);
        }
        for (let ft of floatingTexts) {
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(ft.text, ft.x, ft.y);
        }
    }

    function drawStartScreen() {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 40px "Segoe UI"';
        ctx.fillText('SHOUT RUNNER', INTERNAL_W / 2 - 180, 200);
        ctx.font = '18px sans-serif';
        ctx.fillText('Use your VOICE to run, jump and shout!', INTERNAL_W / 2 - 170, 260);
        ctx.fillText('🎤 Click anywhere to start and allow microphone', INTERNAL_W / 2 - 210, 310);
        if (!micActive) {
            ctx.fillStyle = '#ff5e7a';
            ctx.fillText('(Microphone required)', INTERNAL_W / 2 - 100, 350);
        }
    }

    function drawBossWarning() {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
        ctx.fillStyle = '#ff3860';
        ctx.font = '36px sans-serif';
        ctx.fillText(`⚠️ BOSS: ${getLevelConfig(currentLevel).bossName}`, INTERNAL_W / 2 - 220, 260);
        ctx.fillText('Get ready...', INTERNAL_W / 2 - 80, 310);
    }

    function drawGameOver() {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText('GAME OVER', INTERNAL_W / 2 - 120, 220);
        ctx.fillText(`Score: ${score}`, INTERNAL_W / 2 - 60, 280);
        ctx.fillText('Click to restart', INTERNAL_W / 2 - 80, 340);
    }

    function drawVictory() {
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 44px sans-serif';
        ctx.fillText('🏆 YOU WIN! 🏆', INTERNAL_W / 2 - 180, 230);
        ctx.fillText(`Final Score: ${score}`, INTERNAL_W / 2 - 130, 290);
    }

    function render() {
        ctx.clearRect(0, 0, INTERNAL_W, INTERNAL_H);
        ctx.save();
        if (shakeAmount > 0.5) {
            const dx = (Math.random() - 0.5) * shakeAmount;
            const dy = (Math.random() - 0.5) * shakeAmount;
            ctx.translate(dx, dy);
        }
        drawBackground();
        drawObstacles();
        drawPowerUps();
        if (gameState === STATE.BOSS_FIGHT) {
            drawBoss();
            drawBossAttacks();
        }
        drawPlayer();
        drawUI();
        drawMessages();

        if (gameState === STATE.START) drawStartScreen();
        if (gameState === STATE.BOSS_WARNING) drawBossWarning();
        if (gameState === STATE.GAME_OVER) drawGameOver();
        if (gameState === STATE.VICTORY) drawVictory();
        ctx.restore();
    }

    // ─────────────────────────────────────
    // GAME LOOP
    // ─────────────────────────────────────
    function gameLoop() {
        update();
        render();
        requestAnimationFrame(gameLoop);
    }

    // ─────────────────────────────────────
    // EVENT LISTENERS
    // ─────────────────────────────────────
    canvas.addEventListener('click', async () => {
        if (gameState === STATE.START) {
            if (!micActive) {
                gameState = STATE.MIC_WAIT;
                await requestMicrophone();
                if (micActive) {
                    startGame();
                } else {
                    gameState = STATE.START;
                }
            } else {
                startGame();
            }
        } else if (gameState === STATE.GAME_OVER) {
            restartFromGameOver();
        } else if (gameState === STATE.VICTORY) {
            currentLevel = 1;
            startGame();
        }
    });

    // Pre-request microphone on load for better UX
    window.addEventListener('load', () => {
        requestMicrophone().then(() => {
            if (micActive && gameState === STATE.START) {
                // ready
            }
        });
    });

    // Start the loop
    gameLoop();
})();