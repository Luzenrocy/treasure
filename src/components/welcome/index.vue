<template>
  <div class="welcome-container">
    <div class="welcome-text">
      <h1>欢迎使用 treasure</h1>
      <p>希望能够对您有所帮助</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// Welcome component
</script>

<style scoped>
.welcome-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  width: 100%;
  background-color: var(--treasure-background-color); /* Adapt to theme if available, otherwise white/default */
  color: var(--el-text-color-primary);
}

.welcome-text {
  text-align: center;
}

h1 {
  font-size: 2rem;
  margin-bottom: 1rem;
}

p {
  font-size: 1.2rem;
  opacity: 0.8;
}
</style>
