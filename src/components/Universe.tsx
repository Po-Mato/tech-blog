import React, { useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { BloomEffect, BlendFunction, KernelSize } from "postprocessing";
import smoke from "/smoke.png";

const Universe: React.FC = () => {
	useEffect(() => {
		const container = document.getElementById("div_universe");
		const scene = new THREE.Scene();
		const sizes = {
			width: window.innerWidth,
			height: window.innerHeight,
		};
		const camera = new THREE.PerspectiveCamera(
			45,
			window.innerWidth / window.innerHeight,
			0.1,
			2000,
		);
		camera.position.z = 100;
		scene.add(camera);

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(sizes.width, sizes.height);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setClearColor(new THREE.Color("#11181a"), 1);
		container?.appendChild(renderer.domElement);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.minDistance = 1;
		controls.maxDistance = 1000;

		interface OptionStart {
			color: string;
			count: number;
			size: number;
		}
		const arrPoint: object[] = [];
		const drawStar = (option: OptionStart) => {
			const vertices = [];
			const getRandomSphere = (radius: number) => {
				let x: number;
				let y: number;
				let z: number;
				do {
					x = Math.random() * 2 - 1;
					y = Math.random() * 2 - 1;
					z = Math.random() * 2 - 1;
				} while (x ** 2 + y ** 2 + z ** 2 > 1);
				const norm = 1 - Math.sqrt(x * x + y * y + z * z);
				return [(x / norm) * radius, (y / norm) * radius, (z / norm) * radius];
			};
			for (let i = 0; i < option?.count || 0; i++) {
				const points = getRandomSphere(10);
				vertices.push(...points);
			}
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d");
			canvas.width = 100;
			canvas.height = 100;
			if (ctx) {
				ctx.fillStyle = option.color;
				ctx.beginPath();
				ctx.arc(50, 50, 25, 0, 2 * Math.PI);
				ctx.fill();
			}
			let img = canvas.toDataURL("image/png");
			const loader = new THREE.TextureLoader();
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute(
				"position",
				new THREE.Float32BufferAttribute(vertices, 3),
			);
			let material = new THREE.PointsMaterial({
				size: option.size,
				sizeAttenuation: true,
				map: loader.load(img),
				alphaTest: 0.5,
				transparent: true,
			});
			const points = new THREE.Points(geometry, material);
			scene.add(points);
			if (ctx) {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.fillStyle = `rgba(${option.color.replace(/\#(..)(..)(..)/, (match, p1, p2, p3) => `${Number.parseInt(p1, 16)}, ${Number.parseInt(p2, 16)}, ${Number.parseInt(p3, 16)}`)}, 0.5)`;
				ctx.beginPath();
				ctx.arc(50, 50, 25, 0, 2 * Math.PI);
				ctx.fill();
			}
			img = canvas.toDataURL("image/png");
			material = new THREE.PointsMaterial({
				size: option.size * 1.5,
				sizeAttenuation: true,
				map: loader.load(img),
				alphaTest: 0.5,
				transparent: true,
			});
			const points2 = new THREE.Points(geometry, material);
			scene.add(points2);
			return [points, points2];
		};
		arrPoint.push(...drawStar({ color: "#BFDFFF", count: 1000, size: 1.0 }));
		arrPoint.push(...drawStar({ color: "#DFEFFF", count: 1000, size: 0.9 }));
		arrPoint.push(...drawStar({ color: "#FFFFFF", count: 1000, size: 0.8 }));
		arrPoint.push(...drawStar({ color: "#FFDFBF", count: 1000, size: 0.7 }));
		arrPoint.push(...drawStar({ color: "#FFBF7F", count: 1000, size: 0.6 }));

		interface OptionNebula {
			size: number;
			count: number;
		}
		const cloudParticles: THREE.Mesh[] = [];
		const drawNebula = (option: OptionNebula) => {
			const loader = new THREE.TextureLoader();
			const texture = loader.load(smoke);
			const cloudGeo = new THREE.PlaneGeometry(option.size, option.size);
			const cloudMaterial = new THREE.MeshLambertMaterial({
				map: texture,
				transparent: true,
				alphaTest: 0.1,
				side: THREE.DoubleSide,
			});
			const Center = [
				Math.random() * 100 - 50,
				Math.random() * 100 - 50,
				Math.random() * 100 - 50,
			];
			for (let p = 0; p < option.count; p++) {
				const cloud = new THREE.Mesh(cloudGeo, cloudMaterial);
				cloud.position.set(
					Center[0] + (Math.random() * option.size) / 2 - option.size / 4,
					Center[1] + (Math.random() * option.size) / 2 - option.size / 4,
					Center[2] + (Math.random() * option.size) / 2 - option.size / 4,
				);
				cloud.rotation.x = 0;
				cloud.rotation.y = 0;
				cloud.rotation.z = Math.random() * 2 * Math.PI;
				cloud.material.opacity = 0.5;
				cloudParticles.push(cloud);
				scene.add(cloud);
			}
		};
		drawNebula({ size: 20, count: 5 });
		drawNebula({ size: 15, count: 6 });
		drawNebula({ size: 12, count: 7 });
		drawNebula({ size: 10, count: 8 });
		drawNebula({ size: 7, count: 9 });
		drawNebula({ size: 5, count: 10 });

		const directionalLight = new THREE.DirectionalLight(0xff8c19);
		directionalLight.position.set(0, 0, 1);
		scene.add(directionalLight);

		const bloomEffect = new BloomEffect({
			blendFunction: BlendFunction.COLOR_DODGE,
			kernelSize: KernelSize.SMALL,
			luminanceThreshold: 0.3,
			luminanceSmoothing: 0.75,
		});
		bloomEffect.blendMode.opacity.value = 1.5;

		const orangeLight = new THREE.PointLight(0xcc6600, 50, 450, 1.7);
		orangeLight.position.set(200, 300, 100);
		scene.add(orangeLight);

		const redLight = new THREE.PointLight(0xd8547e, 50, 450, 1.7);
		redLight.position.set(100, 300, 100);
		scene.add(redLight);

		const blueLight = new THREE.PointLight(0x3677ac, 50, 450, 1.7);
		blueLight.position.set(300, 300, 200);
		scene.add(blueLight);

		let nRotate = 0;
		const animate = () => {
			requestAnimationFrame(animate);
			for (const Point of arrPoint as THREE.Points[]) {
				if (Point.rotation) {
					Point.rotation.y = Math.atan2(Math.sin(nRotate), Math.cos(nRotate));
				}
			}
			nRotate += 0.0001;
			controls.update();
			renderer.render(scene, camera);
		};
		animate();

		window.onresize = () => {
			renderer.setSize(window.innerWidth, window.innerHeight);
			camera.aspect = window.innerWidth / window.innerHeight;
			camera.updateProjectionMatrix();
		};

		// cleanup
		return () => {
			window.onresize = null;
			renderer.dispose();
			container?.removeChild(renderer.domElement);
		};
	}, []);

	return (
		<div
			id="div_universe"
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				zIndex: -1,
			}}
		/>
	);
};

export default Universe;
