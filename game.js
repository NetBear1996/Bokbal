// Bokbal — Flappy Rugby clone
// Controls: Space / Click / Tap

(function () {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d', { alpha: false });
    const scoreEl = document.getElementById('score');
    const overlay = document.getElementById('overlay');
    const finalScore = document.getElementById('final-score');
    const restartBtn = document.getElementById('restart');
    const startOverlay = document.getElementById('start-overlay');
    const startBtn = document.getElementById('start-btn');
    const playerNameInput = document.getElementById('player-name');
    const storedHighscoreEl = document.getElementById('stored-highscore');
    const storedHighnameEl = document.getElementById('stored-highname');
    const highscoreHUD = document.getElementById('highscore');
    const highscoreDisplay = document.getElementById('highscore-display');
    const highscoreNameDisplay = document.getElementById('highscore-name');

    // logical size for consistent physics
    const W = 480;
    const H = 640;

    function resize() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = W;
        canvas.height = H;
        // scale CSS to fit rect
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
    }
    window.addEventListener('resize', resize, { passive: true });
    // initial resize after layout
    setTimeout(resize, 10);

    // Game state
    let running = false;
    let frames = 0;
    let pipes = [];
    let spawnTimer = 0;
    let score = 0;
    let highScore = 0;
    let started = false;
    let gameOver = false;
    let playerName = 'Player';
    let playing = false; // true when gameplay (gravity & input) is active
    let preStart = false; // true during countdown before "Tap"
    let preStartRemaining = 0; // ms remaining in countdown
    let showTap = false; // true when countdown finished and waiting for tap
    let lastTimestamp = null; // for delta timing

    // persisted high score
    let storedHigh = parseInt(localStorage.getItem('bokbalHighScore')) || 0;
    let storedHighName = localStorage.getItem('bokbalHighName') || '—';

    function refreshHighscoreDisplays() {
        if (storedHighscoreEl) storedHighscoreEl.textContent = storedHigh;
        if (storedHighnameEl) storedHighnameEl.textContent = storedHighName;
        if (highscoreHUD) highscoreHUD.textContent = 'HS: ' + storedHigh;
        if (highscoreDisplay && highscoreNameDisplay) {
            highscoreDisplay.textContent = 'High score: ' + storedHigh + ' — ';
            highscoreNameDisplay.textContent = storedHighName;
        }
    }
    refreshHighscoreDisplays();

    // Ball (rugby)
    const ball = {
        x: W * 0.25,
        y: H * 0.45,
        r: 18, // visual radius
        vy: 0,
        rotation: 0,
    };

    // difficulty tiers
    let difficulty = 'normal'; // 'slow' | 'normal' | 'fast'
    function updateDifficulty() {
        // tiers based on score
        if (score < 5) {
            difficulty = 'slow';
            // easier: slower pipes, longer spawn interval
            pipeSpeed = 1.6;
            spawnInterval = 140;
        } else if (score < 12) {
            difficulty = 'normal';
            pipeSpeed = 2.6;
            spawnInterval = 110;
        } else {
            difficulty = 'fast';
            pipeSpeed = 3.6;
            spawnInterval = 90;
        }
    }
    // initialize difficulty vars
    let pipeSpeed = 2.6;
    let spawnInterval = 110;

    // Physics tuned similar to Flappy Bird (tweaked for snappier feel)
    const gravity = 0.55; // slightly stronger gravity
    const jumpImpulse = -10.0; // slightly stronger jump to match gravity
    const maxDropSpeed = 14; // allow faster falling

    // Pipes (goal posts) settings
    const pipeWidth = 56;
    const gapMin = 140;
    const gapMax = 190;
    // pipeSpeed and spawnInterval are defined above to support dynamic difficulty

    // Colors / theme
    const colors = {
        sky: '#6ec1ff',
        field: '#2e8b2e',
        post: '#ffffff',
        postAccent: '#ffd24d',
        ballBrown: '#8b4f24',
        ballStripe: '#fff',
        shadow: 'rgba(0,0,0,0.18)',
    };

    function resetGame() {
        pipes = [];
        frames = 0;
        spawnTimer = 0;
        score = 0;
        ball.x = W * 0.25;
        ball.y = H * 0.45;
        ball.vy = 0;
        ball.rotation = 0;
        started = false;
        gameOver = false;
        running = true;
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
        // ensure overlay is removed from layout (robust hide)
        overlay.style.display = 'none';
        scoreEl.textContent = '0';
        // prepare pre-start countdown (3 seconds) then show "Tap"
        // reset pre-start / playing flags (countdown started separately)
        playing = false;
        preStart = true;
        preStartRemaining = 3000;
        preStart = false;
        preStartRemaining = 0;
        showTap = false;
        lastTimestamp = null;
        // ensure the main loop is running after a restart
        requestAnimationFrame(loop);
    }

    function startCountdown(ms = 3000) {
        // prepare pre-start countdown (ms milliseconds) then show "Tap"
        playing = false;
        preStart = true;
        preStartRemaining = ms;
        showTap = false;
        lastTimestamp = null;
    }

    // Leaderboard (persistent top 5)
    function loadLeaderboard() {
        try {
            const raw = localStorage.getItem('bokbalLeaderboard');
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveLeaderboard(list) {
        try {
            localStorage.setItem('bokbalLeaderboard', JSON.stringify(list));
        } catch (e) { }
    }

    function updateLeaderboardDisplay() {
        const wrap = document.getElementById('leaderboard');
        if (!wrap) return;
        const list = loadLeaderboard();
        wrap.innerHTML = '';
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const li = document.createElement('li');
            li.textContent = `${i + 1}. ${item.name} — ${item.score}`;
            wrap.appendChild(li);
        }
    }

    function addToLeaderboard(name, score) {
        const list = loadLeaderboard();
        list.push({ name: name || 'Player', score: Number(score) || 0, date: Date.now() });
        list.sort((a, b) => b.score - a.score || a.date - b.date);
        const top = list.slice(0, 5);
        saveLeaderboard(top);
        updateLeaderboardDisplay();
    }

    // initialize leaderboard UI
    updateLeaderboardDisplay();

    function startIfNeeded() {
        if (!started) started = true;
    }

    function jump() {
        if (gameOver) return;
        // if in countdown phase, ignore taps
        if (preStart && preStartRemaining > 0) return;
        // if waiting for tap after countdown, start playing on first tap
        if (preStart && showTap) {
            playing = true;
            preStart = false;
            showTap = false;
            startIfNeeded();
            ball.vy = jumpImpulse;
            return;
        }
        if (!playing) return; // only allow jump when playing
        startIfNeeded();
        ball.vy = jumpImpulse;
    }

    // input
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            if (gameOver) resetGame();
            e.preventDefault(); a
            if (gameOver) { resetGame(); startCountdown(); }
            jump();
        }
    });

    canvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (gameOver) resetGame();
        if (gameOver) { resetGame(); startCountdown(); }
        jump();
    });
    canvas.addEventListener(
        'touchstart',
        (e) => {
            e.preventDefault();
            if (gameOver) { resetGame(); return; }
            if (gameOver) { resetGame(); startCountdown(); return; }
            jump();
        },
        { passive: false }
    );

    // single restart handler
    restartBtn.addEventListener('click', (e) => { e.preventDefault(); resetGame(); });
    restartBtn.addEventListener('click', (e) => { e.preventDefault(); resetGame(); startCountdown(); });

    // fallback delegation in case startBtn reference was not found
    document.body.addEventListener('click', (e) => {
        if (!e.target) return;
        if (e.target.id === 'start-btn') {
            console.log('Start (delegated) clicked');
            e.preventDefault();
            const name = (playerNameInput && playerNameInput.value && playerNameInput.value.trim()) || 'Player';
            playerName = name.substring(0, 24);
            if (startOverlay) startOverlay.style.display = 'none';
            updateLeaderboardDisplay();
            resetGame();
            startCountdown();
            running = true;
            requestAnimationFrame(loop);
        }
    });

    // start button handler: ensure it exist and starts game
    if (startBtn) {
        startBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const name = (playerNameInput && playerNameInput.value && playerNameInput.value.trim()) || 'Player';
            playerName = name.substring(0, 24);
            if (startOverlay) startOverlay.style.display = 'none';
            // ensure leaderboard display refreshed
            updateLeaderboardDisplay();
            resetGame();
            startCountdown();
            running = true;
            requestAnimationFrame(loop);
        });
    }

    // Provide a global startGame() for an inline onclick fallback
    window.startGame = function () {
        console.log('startGame() called');
        const name = (playerNameInput && playerNameInput.value && playerNameInput.value.trim()) || 'Player';
        playerName = name.substring(0, 24);
        if (startOverlay) startOverlay.style.display = 'none';
        updateLeaderboardDisplay();
        resetGame();
        running = true;
        requestAnimationFrame(loop);
    };

    // utilities
    function randInt(a, b) {
        return Math.floor(Math.random() * (b - a + 1)) + a;
    }

    function spawnPipe() {
        const gap = randInt(gapMin, gapMax);
        const topH = randInt(60, H - gap - 120);
        const x = W + 20;
        pipes.push({ x: x, top: topH, gap: gap, width: pipeWidth, scored: false });
    }

    function circleRectCollision(cx, cy, r, rx, ry, rw, rh) {
        const closestX = Math.max(rx, Math.min(cx, rx + rw));
        const closestY = Math.max(ry, Math.min(cy, ry + rh));
        const dx = cx - closestX;
        const dy = cy - closestY;
        return dx * dx + dy * dy <= r * r;
    }

    function update() {
        if (!running) return;
        frames++;

        // timing
        // lastTimestamp updated in loop; if not present use fixed delta

        // handle pre-start countdown timing and showTap state (no physics yet)
        // (countdown handled in loop via timestamps) -- nothing to do here

        // spawn pipes only when started (gameplay active)
        if (started) {
            spawnTimer++;
            if (spawnTimer >= spawnInterval) {
                spawnTimer = 0;
                spawnPipe();
            }
        }

        // physics only when playing
        if (playing) {
            ball.vy += gravity;
            if (ball.vy > maxDropSpeed) ball.vy = maxDropSpeed;
            ball.y += ball.vy;
            ball.rotation = Math.max(Math.min(ball.vy / 12, 0.8), -0.8);
        }

        // update pipes
        for (let i = pipes.length - 1; i >= 0; i--) {
            const p = pipes[i];
            p.x -= pipeSpeed;
            if (!p.scored && p.x + p.width < ball.x - ball.r) {
                score++;
                p.scored = true;
                scoreEl.textContent = score;
                // update difficulty when score increases
                updateDifficulty();
            }
            if (p.x + p.width < -40) pipes.splice(i, 1);
        }

        // collisions: with ground and ceiling
        const groundY = H * 0.92;
        if (ball.y + ball.r >= groundY) {
            ball.y = groundY - ball.r;
            if (playing) endGame();
        }
        if (ball.y - ball.r <= 12) {
            ball.y = 12 + ball.r;
            ball.vy = 0;
        }

        // collisions with pipes (goal posts)
        for (const p of pipes) {
            const topRect = { x: p.x, y: 0, w: p.width, h: p.top };
            const bottomRect = { x: p.x, y: p.top + p.gap, w: p.width, h: H - (p.top + p.gap) };

            if (circleRectCollision(ball.x, ball.y, ball.r - 3, topRect.x, topRect.y, topRect.w, topRect.h)) {
                endGame();
            }
            if (circleRectCollision(ball.x, ball.y, ball.r - 3, bottomRect.x, bottomRect.y, bottomRect.w, bottomRect.h)) {
                endGame();
            }
            if (gameOver) break;
        }
    }

    function endGame() {
        if (gameOver) return;
        gameOver = true;
        running = false;
        finalScore.textContent = 'Score: ' + score;
        // add to leaderboard and update persisted high score
        addToLeaderboard(playerName || 'Player', score);
        if (score > storedHigh) {
            storedHigh = score;
            storedHighName = playerName || 'Player';
            localStorage.setItem('bokbalHighScore', String(storedHigh));
            localStorage.setItem('bokbalHighName', storedHighName);
        }
        refreshHighscoreDisplays();
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        // ensure overlay is visible
        overlay.style.display = 'flex';
        // update highScore variable too for compatibility
        if (score > highScore) highScore = score;
    }

    // Drawing helpers
    function drawBackground() {
        // sky
        ctx.fillStyle = colors.sky;
        ctx.fillRect(0, 0, W, H);

        // field band at bottom
        const fieldTop = H * 0.6;
        const gradient = ctx.createLinearGradient(0, fieldTop, 0, H);
        gradient.addColorStop(0, '#2fae2f');
        gradient.addColorStop(1, '#196b19');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, fieldTop, W, H - fieldTop);

        // faint center line
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 2;
        ctx.setLineDash([12, 10]);
        ctx.beginPath();
        ctx.moveTo(W * 0.5, fieldTop + 6);
        ctx.lineTo(W * 0.5, H - 6);
        ctx.stroke();
        ctx.setLineDash([]);

        // draw Table Mountain silhouette on the horizon (flat-topped plateau)
        ctx.save();
        // position mountain slightly above the field top so it overlaps the horizon
        ctx.translate(0, fieldTop - 40);

        // main flat plateau (Table Mountain iconic flat top)
        ctx.beginPath();
        ctx.moveTo(-40, 90);
        ctx.lineTo(40, 20);
        ctx.lineTo(120, 10);
        ctx.lineTo(200, -30); // start of plateau
        ctx.lineTo(340, -30); // plateau top across
        ctx.lineTo(420, 10);
        ctx.lineTo(500, 40);
        ctx.lineTo(W + 50, H);
        ctx.lineTo(-50, H);
        ctx.closePath();
        ctx.fillStyle = '#2a3d33'; // dark mountain color
        ctx.fill();

        // sharper ridge highlight along the plateau edge
        ctx.beginPath();
        ctx.moveTo(140, -18);
        ctx.lineTo(200, -30);
        ctx.lineTo(340, -30);
        ctx.lineTo(380, -18);
        ctx.quadraticCurveTo(420, -6, 460, 6);
        ctx.lineTo(W + 50, H);
        ctx.lineTo(-50, H);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fill();

        // add Devil's Peak to the left of plateau
        ctx.beginPath();
        ctx.moveTo(60, 20);
        ctx.quadraticCurveTo(100, -10, 140, 18);
        ctx.lineTo(140, 40);
        ctx.lineTo(60, 80);
        ctx.closePath();
        ctx.fillStyle = '#23332b';
        ctx.fill();

        // add Lion's Head small dome to the right
        ctx.beginPath();
        ctx.moveTo(360, 10);
        ctx.quadraticCurveTo(390, -8, 410, 10);
        ctx.lineTo(410, 40);
        ctx.lineTo(360, 60);
        ctx.closePath();
        ctx.fillStyle = '#263a31';
        ctx.fill();

        ctx.restore();

        // draw countdown or tap prompt if preStart
        if (preStart || showTap) {
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (preStart && preStartRemaining > 0) {
                const sec = Math.ceil(preStartRemaining / 1000);
                ctx.font = '72px Poppins, Arial';
                ctx.fillStyle = 'white';
                ctx.fillText(String(sec), W / 2, H / 2 - 20);
            } else if (showTap) {
                ctx.font = '44px Poppins, Arial';
                ctx.fillStyle = 'white';
                ctx.fillText('Tap to play', W / 2, H / 2 - 10);
            }
            ctx.restore();
        }
    }

    function drawGoalPost(x, y, w, h) {
        ctx.fillStyle = colors.post;
        const postWidth = Math.max(6, Math.floor(w * 0.24));
        ctx.fillRect(x, y, postWidth, h);
        ctx.fillRect(x + w - postWidth, y, postWidth, h);
        ctx.fillRect(x, y + h - 10, w, 10);
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
    }

    function drawPipes() {
        for (const p of pipes) {
            const topH = p.top;
            ctx.save();
            ctx.fillStyle = '#e9eef0';
            ctx.fillRect(p.x, 0, p.width, topH);
            drawGoalPost(p.x, 0, p.width, topH);
            ctx.fillStyle = colors.postAccent;
            ctx.fillRect(p.x + 6, Math.max(6, topH - 20), p.width - 12, 6);
            ctx.restore();

            const bottomY = p.top + p.gap;
            const bottomH = H - bottomY;
            ctx.save();
            ctx.fillStyle = '#e9eef0';
            ctx.fillRect(p.x, bottomY, p.width, bottomH);
            drawGoalPost(p.x, bottomY, p.width, bottomH);
            ctx.fillStyle = colors.postAccent;
            ctx.fillRect(p.x + 6, bottomY + 6, p.width - 12, 6);
            ctx.restore();
        }
    }

    function drawRugbyBall(x, y, r, rotation) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.scale(1.4, 1);
        ctx.beginPath();
        ctx.ellipse(0, r * 0.6, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = colors.shadow;
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fillStyle = colors.ballBrown;
        ctx.fill();
        ctx.strokeStyle = '#5b2f19';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.5, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fillStyle = colors.ballStripe;
        ctx.fill();

        ctx.strokeStyle = '#6b3f2a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.12, -r * 0.08);
        ctx.lineTo(r * 0.12, -r * 0.08);
        ctx.moveTo(-r * 0.12, 0);
        ctx.lineTo(r * 0.12, 0);
        ctx.moveTo(-r * 0.12, r * 0.08);
        ctx.lineTo(r * 0.12, r * 0.08);
        ctx.stroke();

        ctx.restore();
    }

    function render() {
        ctx.clearRect(0, 0, W, H);
        drawBackground();
        drawPipes();
        drawRugbyBall(ball.x, ball.y, ball.r, ball.rotation);
        const groundY = H * 0.92;
        ctx.fillStyle = '#1f6a1f';
        ctx.fillRect(0, groundY, W, H - groundY);

        // draw credit directly on canvas as a fallback so it always appears
        ctx.save();
        ctx.font = '14px Poppins, system-ui, Arial';
        ctx.fillStyle = '#ffd24d';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 6;
        ctx.fillText('Created by Evan Williams', 12, H - 8);
        ctx.restore();
    }

    function loop(ts) {
        // requestAnimationFrame supplies timestamp
        if (!lastTimestamp) lastTimestamp = ts;
        const delta = ts - lastTimestamp;
        lastTimestamp = ts;

        // handle pre-start countdown timing
        if (preStart && preStartRemaining > 0) {
            preStartRemaining -= delta;
            if (preStartRemaining <= 0) {
                preStartRemaining = 0;
                showTap = true; // show tap prompt until first input
            }
        }

        update();
        render();
        if (!gameOver) requestAnimationFrame(loop);
    }

    // Show start overlay and wait for player to begin
    if (startOverlay) startOverlay.style.display = 'flex';
    running = false;

    window.addEventListener('blur', () => {
        running = false;
    });
    window.addEventListener('focus', () => {
        if (!gameOver) running = true;
        requestAnimationFrame(loop);
    });
})();
