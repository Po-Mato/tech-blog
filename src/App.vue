<template>
  <!-- <div>
    <a href="https://vitejs.dev" target="_blank">
      <img src="/vite.svg" class="logo" alt="Vite logo" />
    </a>
    <a href="https://vuejs.org/" target="_blank">
      <img src="./assets/vue.svg" class="logo vue" alt="Vue logo" />
    </a>
  </div>
  <HelloWorld msg="Vite + Vue" /> -->
  <div id="container"></div>
  <router-link to="/">Home</router-link>
  <router-link to="/about">About</router-link>
  <router-view></router-view>
</template>

<script lang="ts">
import HelloWorld from './components/HelloWorld.vue'
import * as THREE from 'three';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export default {
  data() {
    return {};
  },
  components: {
    HelloWorld,
  },
  mounted() {
    const container = document.getElementById('container');
    const scene = new THREE.Scene();
    const sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.1, 2000 );
    camera.position.x = 100;
    scene.add(camera);
    
    // 배경 넣기
    // const loader = new THREE.TextureLoader();
    // loader.load(
    //   // URL
    //   './public/milkyway.jpg',
    //   // 콜백 함수
    //   function (texture) {
    //     // 장면의 배경에 텍스처 할당
    //     scene.background = texture;
    //   }
    // );

    const renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setSize( sizes.width, sizes.height );
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(new THREE.Color("#21282a"), 1);
    container.appendChild( renderer.domElement );
    
    var texture = new THREE.TextureLoader().load('./public/milkyway.jpg');
    var material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
    var sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 20, 20),
      material
    );
    scene.add(sphere);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 1;
    controls.maxDistance = 1000;

    // const size = 100;
    // const divisions = 100;
    // const gridHelper = new THREE.GridHelper( size, divisions );
    // scene.add( gridHelper );

    const drawStar = (option) => {
      const vertices = [];
      const getRandomSphere = (radius) => {
        let x, y, z;
        do {
          x = Math.random() * 2 - 1;
          y = Math.random() * 2 - 1;
          z = Math.random() * 2 - 1;
        } while (x ** 2 + y ** 2 + z ** 2 > 1);

        const norm = 1 - Math.sqrt(x * x + y * y + z * z);
        return [x / norm * radius, y / norm * radius, z / norm * radius];
      };
      for ( let i = 0; i < option.count; i ++ ) {
        const points = getRandomSphere(10);
        vertices.push( ...points );
      }
      
      let canvas = document.createElement("canvas");
      let ctx = canvas.getContext("2d");
      canvas.height = 100;
      canvas.width = 100;
      ctx.fillStyle = option.color;
      ctx.beginPath();
      ctx.arc(50, 50, 25, 0, 2 * Math.PI);
      ctx.fill();
      let img = canvas.toDataURL("image/png");
      const loader = new THREE.TextureLoader();
      const star = loader.load(img);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
      const material = new THREE.PointsMaterial({
        size: option.size,
        map: star,
        transparent: true,
      });
      const points = new THREE.Points( geometry, material );
      scene.add( points );
    };
    drawStar({ color: '#BFDFFF', count: 1000, size: 1.0 });
    drawStar({ color: '#DFEFFF', count: 1000, size: 0.9 });
    drawStar({ color: '#FFFFFF', count: 1000, size: 0.8 });
    drawStar({ color: '#FFDFBF', count: 1000, size: 0.7 });
    drawStar({ color: '#FFBF7F', count: 1000, size: 0.6 });

    /*
    // const geometry = new THREE.BoxGeometry();
    // const material = new THREE.MeshBasicMaterial( { color: 0x00ff80 } );
    // const cube = new THREE.Mesh( geometry, material );
    // scene.add( cube );

    // sphere
    const geometry = new THREE.TorusGeometry(0.7, 0.2, 16, 100);
    const material = new THREE.PointsMaterial({
      size: 0.005,
      color: 0x87a7ca,
    });
    const sphere = new THREE.Points(geometry, material);
    scene.add(sphere);

    //particle
    const particlesGeometry = new THREE.BufferGeometry();
    const loader = new THREE.TextureLoader();
    let canvas = document.createElement("canvas");
    let ctx = canvas.getContext("2d");
    canvas.height = 100;
    canvas.width = 100;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(50, 50, 25, 0, 2 * Math.PI);
    ctx.fill();
    let img = canvas.toDataURL("image/png");
    const star = loader.load(img);
    const particlesmaterial = new THREE.PointsMaterial({
      size: 0.01,
      map: star,
      transparent: true,
    });
    const particlesCnt = 2000;
    const posArray = new Float32Array(particlesCnt * 3);
    // xyz,xyz,xyz , xyz
    for (let i = 0; i < particlesCnt * 3; i++) {
      //posArray[i] = Math.random()
      //   posArray[i] = Math.random() - 0.5
      //   posArray[i] = (Math.random() - 0.5) * 5
      posArray[i] = (Math.random() - 0.5) * (Math.random() * 5);
    }

    particlesGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(posArray, 3)
    );

    const particlesMesh = new THREE.Points(particlesGeometry, particlesmaterial);
    scene.add(particlesMesh);
    */

    let nRotate = 0;
    const animate = () => {
      requestAnimationFrame(animate);
      camera.position.x = Math.cos(nRotate) * 100;
      // camera.position.y = Math.cos(nRotate) * 100;
      camera.position.z = Math.sin(nRotate) * 100;
      nRotate += 0.0001;
      // camera.position.y = Math.sin(0.01) * 100;
      // camera.position.z = Math.sin(0.01) * 100;
      // cube.rotation.x += 0.01;
      // cube.rotation.y += 0.01;
      controls.update();
      renderer.render(scene, camera);
    }
    animate();
  },
}
</script>

<style scoped>

  #container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    /* z-index: -1; */
    /* background-color: #000000; */
    /* pointer-events: none; */
  }

  .logo {
    height: 6em;
    padding: 1.5em;
    will-change: filter;
    transition: filter 300ms;
  }
  .logo:hover {
    filter: drop-shadow(0 0 2em #646cffaa);
  }
  .logo.vue:hover {
    filter: drop-shadow(0 0 2em #42b883aa);
  }
  
</style>
