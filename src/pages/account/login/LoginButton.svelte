<script lang="ts">
  import { login } from "../../../scripts/matrix/auth";

  let username = "";
  let password = "";

  const authenticate = async () => {
    const auth = await login(username, password);
    console.log(auth);
  };
</script>

<input type="text" placeholder="Username" bind:value={username} />
<input type="password" placeholder="Password" bind:value={password} />

<button on:click={authenticate}>test</button>
