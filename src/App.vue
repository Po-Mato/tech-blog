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
    const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 100 );
    camera.position.z = 2;
    scene.add(camera);

    const renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setSize( sizes.width, sizes.height );
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(new THREE.Color("#21282a"), 1);
    container.appendChild( renderer.domElement );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 1;
    controls.maxDistance = 500;

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

    const animate = () => {
      requestAnimationFrame(animate);
      // cube.rotation.x += 0.01;
      // cube.rotation.y += 0.01;
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // let renderer, scene, camera;
    // let mesh;
    // let raycaster;
    // let line;

    // const intersection = {
    // 	intersects: false,
    // 	point: new THREE.Vector3(),
    // 	normal: new THREE.Vector3()
    // };
    // const mouse = new THREE.Vector2();
    // const intersects = [];

    // let mouseHelper;

    // init();
    // animate();

    // function init() {

    // 	renderer = new THREE.WebGLRenderer( { antialias: true } );
    // 	renderer.setPixelRatio( window.devicePixelRatio );
    // 	renderer.setSize( window.innerWidth, window.innerHeight );
    // 	container.appendChild( renderer.domElement );

    // 	scene = new THREE.Scene();

    // 	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 1000 );
    // 	camera.position.z = 120;

    // 	const controls = new OrbitControls( camera, renderer.domElement );
    // 	controls.minDistance = 50;
    // 	controls.maxDistance = 200;

    // 	scene.add( new THREE.AmbientLight( 0x443333 ) );

      // const geometry2 = new THREE.BufferGeometry();
      // geometry2.setFromPoints( [ new THREE.Vector3(), new THREE.Vector3() ] );

      // line = new THREE.Line( geometry2, new THREE.LineBasicMaterial() );
      // scene.add( line );

      // raycaster = new THREE.Raycaster();

      // mouseHelper = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 10 ), new THREE.MeshNormalMaterial() );
      // mouseHelper.visible = false;
      // scene.add( mouseHelper );

      // const boxWidth = 1, boxHeight = 1, boxDepth = 1;
      // const geometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);
      // const material = new THREE.MeshBasicMaterial({color: 0x44aa88});
      // const cube = new THREE.Mesh(geometry, material);
      // scene.add(cube);

      // window.addEventListener( 'resize', onWindowResize );

      // let moved = false;

      // controls.addEventListener( 'change', function () {

      // 	moved = true;

      // } );

      // window.addEventListener( 'pointerdown', function () {

      // 	moved = false;

      // } );

      // window.addEventListener( 'pointerup', function ( event ) {

      // 	if ( moved === false ) {

      // 		checkIntersection( event.clientX, event.clientY );

      // 		if ( intersection.intersects ) console.log('test')// shoot();

      // 	}

      // } );

      // window.addEventListener( 'pointermove', onPointerMove );

      // function onPointerMove( event ) {

      // 	if ( event.isPrimary ) {

      // 		checkIntersection( event.clientX, event.clientY );

      // 	}

      // }

      // function checkIntersection( x, y ) {

      // 	if ( mesh === undefined ) return;

      // 	mouse.x = ( x / window.innerWidth ) * 2 - 1;
      // 	mouse.y = - ( y / window.innerHeight ) * 2 + 1;

      // 	raycaster.setFromCamera( mouse, camera );
      // 	raycaster.intersectObject( mesh, false, intersects );

      // 	if ( intersects.length > 0 ) {

      // 		const p = intersects[ 0 ].point;
      // 		mouseHelper.position.copy( p );
      // 		intersection.point.copy( p );

      // 		const n = intersects[ 0 ].face.normal.clone();
      // 		n.transformDirection( mesh.matrixWorld );
      // 		n.multiplyScalar( 10 );
      // 		n.add( intersects[ 0 ].point );

      // 		intersection.normal.copy( intersects[ 0 ].face.normal );
      // 		mouseHelper.lookAt( n );

      // 		const positions = line.geometry.attributes.position;
      // 		positions.setXYZ( 0, p.x, p.y, p.z );
      // 		positions.setXYZ( 1, n.x, n.y, n.z );
      // 		positions.needsUpdate = true;

      // 		intersection.intersects = true;

      // 		intersects.length = 0;

      // 	} else {

      // 		intersection.intersects = false;

      // 	}

      // }
    // }

    // function onWindowResize() {

    // 	camera.aspect = window.innerWidth / window.innerHeight;
    // 	camera.updateProjectionMatrix();

    // 	renderer.setSize( window.innerWidth, window.innerHeight );

    // }

    // function animate() {

    // 	requestAnimationFrame( animate );

    // 	renderer.render( scene, camera );

    // }
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
