import { API, baseURL } from "../../api/client";
import { serialiseURIObject } from "../../misc/uri";
import { Client } from "../client";

export const getAuthenticatedMedia = async (
  url: string,
  params?: {
    width?: number;
    height?: number;
    method?: "crop" | "scale";
    animated?: boolean;
    allow_redirect?: boolean;
  },
  asLink: boolean = false,
  homeserver: string = Client.getHomeserverUrl() ?? "https://matrix.org",
) => {
  const [serverName, mediaId] = url.slice(6).split("/");

  const response = await API({
    base: baseURL.CUSTOM(homeserver, true),
    endpoint: `_matrix/client/v1/media/thumbnail/${serverName}/${mediaId}?${serialiseURIObject(params)}`,
    method: "GET",
    headers: {
      Authorization: "Bearer " + Client.getAccessToken(),
    },
  });

  if (!response.ok)
    throw new Error("There was a problem accessing this mxc media.");

  const blob = await response.blob();

  return asLink ? URL.createObjectURL(blob) : blob;
};
