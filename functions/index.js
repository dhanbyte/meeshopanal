const { createHmac, randomUUID } = require("node:crypto");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

admin.initializeApp();

const imageKitPrivateKey = defineSecret("IMAGEKIT_PRIVATE_KEY");
const db = admin.firestore();

async function requireStaff(request, clientId) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  if (typeof clientId !== "string" || !clientId) throw new HttpsError("invalid-argument", "Choose a client.");

  const profileSnapshot = await db.doc(`users/${request.auth.uid}`).get();
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists || profile?.active !== true) {
    throw new HttpsError("permission-denied", "This account is not active in Parcel Desk.");
  }
  if (profile.role !== "admin" && profile.role !== "staff") {
    throw new HttpsError("permission-denied", "Only workspace staff can upload files.");
  }
  if (profile.role === "staff" && !(profile.clientIds || []).includes(clientId)) {
    throw new HttpsError("permission-denied", "This client panel is not assigned to your account.");
  }
  return profile;
}

async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const profileSnapshot = await db.doc(`users/${request.auth.uid}`).get();
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists || profile?.active !== true || profile.role !== "admin") {
    throw new HttpsError("permission-denied", "Only an active Parcel Desk administrator can manage client logins.");
  }
  return profile;
}

exports.setClientLogin = onCall(async (request) => {
  let phase = "check_admin_access";
  let clientId = "";
  let uid = "";
  let createdUser = false;
  try {
    const adminProfile = await requireAdmin(request);
    clientId = request.data?.clientId;
    const email = typeof request.data?.email === "string" ? request.data.email.trim().toLowerCase() : "";
    const password = typeof request.data?.password === "string" ? request.data.password : "";
    if (typeof clientId !== "string" || !clientId) throw new HttpsError("invalid-argument", "Choose a client.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "Enter a valid client login email.");

    phase = "load_client_record";
    const clientRef = db.doc(`clients/${clientId}`);
    const clientSnapshot = await clientRef.get();
    if (!clientSnapshot.exists) throw new HttpsError("not-found", "This client record no longer exists.");
    const client = clientSnapshot.data();
    const existingUid = typeof client.authUid === "string" ? client.authUid : "";
    if (!existingUid && password.length < 6) {
      throw new HttpsError("invalid-argument", "Set a password with at least 6 characters for the new client login.");
    }
    if (password && password.length < 6) throw new HttpsError("invalid-argument", "Password must contain at least 6 characters.");

    uid = existingUid;
    if (existingUid) {
      phase = "check_existing_login";
      const profileSnapshot = await db.doc(`users/${existingUid}`).get();
      const clientProfile = profileSnapshot.data();
      if (profileSnapshot.exists && (clientProfile.role !== "client" || clientProfile.clientId !== clientId)) {
        throw new HttpsError("permission-denied", "This login is linked to a different workspace account.");
      }
      const authUpdate = { email, displayName: client.contactName || client.businessName || client.name };
      if (password) authUpdate.password = password;
      phase = "update_auth_user";
      await admin.auth().updateUser(existingUid, authUpdate);
    } else {
      phase = "create_auth_user";
      const user = await admin.auth().createUser({ email, password, displayName: client.contactName || client.businessName || client.name });
      uid = user.uid;
      createdUser = true;
    }

    const batch = db.batch();
    phase = "save_client_profile";
    batch.set(db.doc(`users/${uid}`), {
      name: client.contactName || client.businessName || client.name,
      role: "client",
      active: client.active === true,
      clientId,
      createdBy: adminProfile.uid || request.auth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.update(clientRef, { loginEmail: email, authUid: uid });
    await batch.commit();
    return { uid };
  } catch (error) {
    if (createdUser && uid) await admin.auth().deleteUser(uid).catch(() => undefined);
    if (error instanceof HttpsError) throw error;
    if (error?.code === "auth/email-already-exists") throw new HttpsError("already-exists", "This email already belongs to a Firebase account. Use a new email or link that account through Firebase setup.");
    if (error?.code === "auth/invalid-email") throw new HttpsError("invalid-argument", "Firebase rejected this email address. Check the login ID and try again.");
    if (error?.code === "auth/invalid-password") throw new HttpsError("invalid-argument", "Firebase rejected this password. Use at least 6 characters and satisfy the password policy configured for this project.");
    if (error?.code === "auth/user-not-found") throw new HttpsError("not-found", "This client has an old login link that no longer exists. Remove the stale link, then create the login again.");

    // Keep server details in Cloud Functions logs only; never log the submitted email or password.
    logger.error("setClientLogin failed", {
      phase,
      errorCode: typeof error?.code === "string" ? error.code : "unknown",
    });
    throw new HttpsError("internal", "Firebase could not finish setting up this client login. Check the setClientLogin Function logs in Firebase Console, then retry.");
  }
});

exports.createImageKitUploadAuth = onCall({ secrets: [imageKitPrivateKey] }, async (request) => {
  await requireStaff(request, request.data?.clientId);
  const privateKey = imageKitPrivateKey.value();
  if (!privateKey) throw new HttpsError("failed-precondition", "ImageKit private key is not configured on the server.");

  const token = randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 30 * 60;
  const signature = createHmac("sha1", privateKey).update(`${token}${expire}`).digest("hex");
  return { token, expire, signature };
});

exports.deleteImageKitAsset = onCall({ secrets: [imageKitPrivateKey] }, async (request) => {
  await requireStaff(request, request.data?.clientId);
  const fileId = request.data?.fileId;
  if (typeof fileId !== "string" || !fileId) throw new HttpsError("invalid-argument", "Missing ImageKit file ID.");

  const credentials = Buffer.from(`${imageKitPrivateKey.value()}:`).toString("base64");
  const fileEndpoint = `https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`;
  const detailsResponse = await fetch(`${fileEndpoint}/details`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (detailsResponse.status === 404) return { deleted: true };
  if (!detailsResponse.ok) {
    throw new HttpsError("internal", `ImageKit could not verify the uploaded file (${detailsResponse.status}).`);
  }
  const details = await detailsResponse.json();
  const filePath = typeof details.filePath === "string" ? `/${details.filePath.replace(/^\/+/, "")}` : "";
  if (!filePath.startsWith(`/parceldesk/${request.data.clientId}/`)) {
    throw new HttpsError("permission-denied", "This file does not belong to the selected client.");
  }

  const response = await fetch(fileEndpoint, {
    method: "DELETE",
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new HttpsError("internal", `ImageKit could not remove the uploaded file (${response.status}).`);
  }
  return { deleted: true };
});

function getSignedPrivateUrl(fileUrl, privateKey) {
  let assetUrl;
  try {
    assetUrl = new URL(fileUrl);
  } catch {
    throw new HttpsError("failed-precondition", "The stored ImageKit file URL is invalid.");
  }
  if (assetUrl.protocol !== "https:" || assetUrl.hostname !== "ik.imagekit.io") {
    throw new HttpsError("failed-precondition", "This ImageKit account must use its default ik.imagekit.io URL endpoint.");
  }

  const parts = assetUrl.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new HttpsError("failed-precondition", "The stored ImageKit file path is invalid.");
  assetUrl.searchParams.delete("ik-t");
  assetUrl.searchParams.delete("ik-s");

  const expire = Math.floor(Date.now() / 1000) + 5 * 60;
  const assetPath = parts.slice(1).join("/");
  const signature = createHmac("sha1", privateKey).update(`${assetPath}${expire}`).digest("hex");
  assetUrl.searchParams.set("ik-t", String(expire));
  assetUrl.searchParams.set("ik-s", signature);
  return assetUrl.toString();
}

exports.getImageKitReturnUrl = onCall({ secrets: [imageKitPrivateKey] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const returnId = request.data?.returnId;
  const fileId = request.data?.fileId;
  if (typeof returnId !== "string" || typeof fileId !== "string") {
    throw new HttpsError("invalid-argument", "Missing return or file reference.");
  }

  const [profileSnapshot, returnSnapshot] = await Promise.all([
    db.doc(`users/${request.auth.uid}`).get(),
    db.doc(`returns/${returnId}`).get(),
  ]);
  const profile = profileSnapshot.data();
  const record = returnSnapshot.data();
  if (!profileSnapshot.exists || profile?.active !== true || !returnSnapshot.exists) {
    throw new HttpsError("permission-denied", "This account cannot open this return evidence.");
  }

  const isAdmin = profile.role === "admin";
  const isAssignedStaff = profile.role === "staff" && (profile.clientIds || []).includes(record.clientId);
  const isSharedClient = profile.role === "client" && profile.clientId === record.clientId && record.sharedWithClient === true;
  if (!isAdmin && !isAssignedStaff && !isSharedClient) {
    throw new HttpsError("permission-denied", "This return evidence is private to the assigned workspace.");
  }

  const file = (record.evidence || []).find((entry) => entry.provider === "imagekit" && entry.fileId === fileId);
  if (!file?.url) throw new HttpsError("not-found", "This media file is not attached to the selected return.");
  return { url: getSignedPrivateUrl(file.url, imageKitPrivateKey.value()) };
});
