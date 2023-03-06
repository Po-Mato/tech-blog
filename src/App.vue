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
  <Universe></Universe>
  <div id="container"></div>
  <router-link to="/">Home</router-link>
  <router-link to="/about">About</router-link>
  <router-view></router-view>
</template>

<script lang="ts">
import HelloWorld from './components/HelloWorld.vue'
import Universe from './components/Universe.vue'

export default {
  data() {
    return {};
  },
  components: {
    HelloWorld,
    Universe,
  },
  mounted() {
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
