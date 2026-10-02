<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NEON OVERDRIVE | Hyper-Engine</title>
    <style>
        body { margin: 0; overflow: hidden; background: #000; font-family: 'Segoe UI', sans-serif; }
        #overlay {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.8); color: #00ff88; z-index: 10;
        }
        #ui {
            position: absolute; top: 20px; left: 20px; color: #00ff88;
            font-size: 24px; font-weight: bold; text-shadow: 0 0 10px #00ff88;
            pointer-events: none;
        }
        button {
            padding: 15px 40px; font-size: 20px; background: transparent;
            border: 2px solid #00ff88; color: #00ff88; cursor: pointer;
            text-transform: uppercase; letter-spacing: 2px; transition: 0.3s;
        }
        button:hover { background: #00ff88; color: #000; box-shadow: 0 0 20px #00ff88; }
        #speed-bar {
            position: absolute; bottom: 30px; right: 30px; width: 200px;
            height: 10px; border: 1px solid #00ff88;
        }
        #speed-fill { width: 0%; height: 100%; background: #00ff88; transition: 0.1s; }
    </style>
</head>
<body>

<div id="ui">SCORE: <span id="score">0</span></div>
<div id="speed-bar"><div id="speed-fill"></div></div>

<div id="overlay">
    <h1>NEON OVERDRIVE</h1>
    <p>A/D or MOUSE to Steer | Avoid the Red Barriers</p>
    <button onclick="startGame()">Initiate Link</button>
</div>

<script type="importmap">
    { "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }
</script>

<script type="module">
    import * as THREE from 'three';

    let scene, camera, renderer, tunnel, obstacles = [];
    let speed = 0.5;
    let score = 0;
    let gameActive = false;
    let targetX = 0;

    function init() {
        scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0x000000, 10, 100);

        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.z = 5;

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        document.body.appendChild(renderer.domElement);

        // Lighting
        const light = new THREE.PointLight(0x00ff88, 10, 50);
        camera.add(light);
        scene.add(camera);

        // Create Tunnel
        const tunnelGeo = new THREE.CylinderGeometry(5, 5, 200, 32, 1, true);
        const tunnelMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            side: THREE.BackSide,
            wireframe: false,
            metalness: 0.9,
            roughness: 0.1
        });
        
        tunnel = new THREE.Mesh(tunnelGeo, tunnelMat);
        tunnel.rotation.x = Math.PI / 2;
        scene.add(tunnel);

        // Grid lines for "Speed" feel
        const grid = new THREE.GridHelper(200, 20, 0x00ff88, 0x002211);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = -50;
        scene.add(grid);

        window.addEventListener('resize', onWindowResize);
        document.addEventListener('mousemove', (e) => {
            targetX = (e.clientX / window.innerWidth - 0.5) * 6;
        });
        document.addEventListener('keydown', (e) => {
            if(e.code === 'KeyA') targetX -= 1;
            if(e.code === 'KeyD') targetX += 1;
        });
    }

    function spawnObstacle() {
        if(!gameActive) return;
        const geo = new THREE.BoxGeometry(2, 0.5, 0.5);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
        const obs = new THREE.Mesh(geo, mat);
        
        obs.position.set(
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 8,
            -100
        );
        scene.add(obs);
        obstacles.push(obs);
        
        setTimeout(spawnObstacle, Math.max(100, 500 - (score/2)));
    }

    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function animate() {
        requestAnimationFrame(animate);

        if (gameActive) {
            speed += 0.0005;
            score += 1;
            document.getElementById('score').innerText = Math.floor(score/10);
            document.getElementById('speed-fill').style.width = (speed * 50) + "%";

            // Camera movement
            camera.position.x += (targetX - camera.position.x) * 0.1;
            camera.rotation.z = -camera.position.x * 0.05;

            // Obstacle movement & Collision
            for (let i = obstacles.length - 1; i >= 0; i--) {
                obstacles[i].position.z += speed;

                // Collision Check
                const dist = obstacles[i].position.distanceTo(camera.position);
                if (dist < 1.2) {
                    endGame();
                }

                if (obstacles[i].position.z > 10) {
                    scene.remove(obstacles[i]);
                    obstacles.splice(i, 1);
                }
            }
        }

        renderer.render(scene, camera);
    }

    window.startGame = () => {
        document.getElementById('overlay').style.display = 'none';
        score = 0;
        speed = 0.5;
        gameActive = true;
        spawnObstacle();
    };

    function endGame() {
        gameActive = false;
        alert("CRITICAL SYSTEM FAILURE. Score: " + Math.floor(score/10));
        location.reload();
    }

    init();
    animate();
</script>
</body>
</html>
