<script lang="ts">
  import { getAuthDetails, login } from "../../../scripts/matrix/auth";
  import { setupClient } from "../../../scripts/matrix/client";

  let username = "";
  let password = "";

  const authenticate = async () => {
    const auth = await login(username, password);
    console.log(auth);
  };

  const client = async () => {
    setupClient();
  };
</script>

<input type="text" placeholder="Username" bind:value={username} />
<input type="password" placeholder="Password" bind:value={password} />

<button on:click={authenticate}>test</button>

<br />

<button on:click={client}>test</button>
