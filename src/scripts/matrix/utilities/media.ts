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

// scheme
// 	https
// host
// 	matrix.org
// filename
// 	/_matrix/client/v1/media/thumbnail/matrix.org/AwOUZEUQjlZgotfDdkhNUEaz
// width
// 	48
// height
// 	48
// method
// 	crop
// animated
// 	true
// allow_redirect
// 	true
// Status
// 200
// VersionHTTP/2
// Transferred3.54 kB (3.54 kB size)
// Referrer Policystrict-origin-when-cross-origin
// DNS ResolutionSystem

// const avatar = getHttpUriForMxc(
//   Client.baseUrl,
//   avatarUrl!,
//   48,
//   48,
//   "crop",
//   false,
//   true,
//   true,
//   true,
// );
//
// const response = fetch(avatar, {
//   method: "GET",
//   headers: {
//     Authorization: "Bearer " + Client.getAccessToken(),
//   },
// })
//   .then((response) => {
//     if (!response.ok) throw new Error("Failed to fetch image");
//     return response.blob(); // convert response to a Blob
//   })
//   .then((blob) => {
//     const imgUrl = URL.createObjectURL(blob); // create a temporary URL
//     const imgEl = document.getElementById("avatar")!
//       .firstElementChild as HTMLImageElement;
//     imgEl.src = imgUrl; // set the src
//   })
//   .catch((err) => {
//     console.error("Error fetching avatar:", err);
//   });
//
