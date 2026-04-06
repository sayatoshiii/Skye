import {
  createClient,
  MatrixClient,
  type ICreateClientOpts,
} from "matrix-js-sdk";
import { getAuthDetails } from "./auth";

export let Client: MatrixClient;

export const setupClient = (clientDetails?: ICreateClientOpts) => {
  const auth = getAuthDetails();

  if (!clientDetails) {
    clientDetails = {
      baseUrl: "https://matrix.org", // temp hardcode; todo custom homeservers
      accessToken: auth.access_token!,
      userId: auth.user_id!,
      deviceId: auth.device_id!,
    };
  }

  if (Client) {
    Client.stopClient();
  }

  Client = createClient(clientDetails);
  Client.startClient();

  return Client; // im sure this will be useful... later!
};

setupClient();
