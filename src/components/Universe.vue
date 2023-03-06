<template>
  <div id="div_universe"></div>
</template>

<script lang="ts">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export default {
  data() {
    return {};
  },
  components: {
  },
  mounted() {
    console.log()
    const container = document.getElementById('div_universe');
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
    renderer.setClearColor(new THREE.Color("#11181a"), 1);
    container.appendChild( renderer.domElement );
    
    // var texture = new THREE.TextureLoader().load('./public/milkyway.jpg');
    // var material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
    // var sphere = new THREE.Mesh(
    //   new THREE.SphereGeometry(1000, 20, 20),
    //   material
    // );
    // scene.add(sphere);

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
      canvas.width = 100;
      canvas.height = 100;
      ctx.fillStyle = option.color;
      ctx.beginPath();
      ctx.arc(50, 50, 25, 0, 2 * Math.PI);
      ctx.fill();
      let img = canvas.toDataURL("image/png");
      const loader = new THREE.TextureLoader();

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );

      let material = new THREE.PointsMaterial({
        size: option.size,
        sizeAttenuation: true,
        map: loader.load(img),
        alphaTest: 0.5,
        transparent: true,
      });
      let points = new THREE.Points( geometry, material );
      scene.add( points );
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = `rgba(${option.color.replace(/\#(..)(..)(..)/, (match, p1, p2, p3) => `${parseInt(p1, 16)}, ${parseInt(p2, 16)}, ${parseInt(p3, 16)}`)}, 0.5)`;
      ctx.beginPath();
      ctx.arc(50, 50, 25, 0, 2 * Math.PI);
      ctx.fill();
      img = canvas.toDataURL("image/png");
      
      material = new THREE.PointsMaterial({
        size: option.size * 1.5,
        sizeAttenuation: true,
        map: loader.load(img),
        alphaTest: 0.5,
        transparent: true,
      });
      points = new THREE.Points( geometry, material );
      scene.add( points );
    };
    drawStar({ color: '#BFDFFF', count: 1000, size: 1.0 });
    drawStar({ color: '#DFEFFF', count: 1000, size: 0.9 });
    drawStar({ color: '#FFFFFF', count: 1000, size: 0.8 });
    drawStar({ color: '#FFDFBF', count: 1000, size: 0.7 });
    drawStar({ color: '#FFBF7F', count: 1000, size: 0.6 });

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

    window.onresize = (e) => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
  },
}

</script>


<style scoped>
#div_universe {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
</style>