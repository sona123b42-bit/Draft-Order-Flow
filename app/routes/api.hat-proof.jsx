import { authenticate } from "../shopify.server";

const CANVAS_SIZE = 100;

const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const toDataUrl = async (source) => {
  const safeSource = String(source || "").trim();
  if (!safeSource) return "";
  if (safeSource.startsWith("data:image/")) return safeSource;

  if (/^https?:\/\//i.test(safeSource)) {
    const response = await fetch(safeSource);
    if (!response.ok) {
      throw new Error(`Unable to fetch image source: ${safeSource}`);
    }

    const mimeType = (response.headers.get("content-type") || "image/png").split(";")[0];
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return `data:${mimeType};base64,${base64}`;
  }

  return "";
};

const buildProofSvgDataUrl = async (side) => {
  const baseImage = await toDataUrl(side?.baseImage);
  if (!baseImage) {
    throw new Error("Missing base image");
  }

  const hasOverlay = String(side?.overlay || "").toLowerCase() !== "no";
  const overlayImage = hasOverlay ? await toDataUrl(side?.overlayImage) : "";

  const left = Number.isFinite(Number(side?.left)) ? Number(side.left) : 36;
  const top = Number.isFinite(Number(side?.top)) ? Number(side.top) : 20;
  const width = Number.isFinite(Number(side?.width)) ? Number(side.width) : 28;
  const height = Number.isFinite(Number(side?.height)) ? Number(side.height) : 17;

  const overlayMarkup = overlayImage
    ? `<image x="${left}" y="${top}" width="${width}" height="${height}" href="${escapeXml(overlayImage)}" xlink:href="${escapeXml(overlayImage)}" preserveAspectRatio="none" />`
    : "";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <image x="0" y="0" width="100%" height="100%" href="${escapeXml(baseImage)}" xlink:href="${escapeXml(baseImage)}" preserveAspectRatio="none" />
  ${overlayMarkup}
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
};

const sanitizeFileStem = (value) =>
  String(value || "proof")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "") || "proof";

const dataUrlToBuffer = async (dataUrl) => {
  const safeDataUrl = String(dataUrl || "");
  const match = safeDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Unsupported proof data URL format");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
};

const stageProofUpload = async (admin, { fileName, mimeType, fileSize }) => {
  const response = await admin.graphql(
    `#graphql
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    {
      variables: {
        input: [
          {
            filename: fileName,
            mimeType,
            httpMethod: "POST",
            resource: "FILE",
            fileSize: String(fileSize),
          },
        ],
      },
    },
  );

  const result = await response.json();
  const payload = result?.data?.stagedUploadsCreate;
  const stagedTarget = payload?.stagedTargets?.[0] || null;

  if (!stagedTarget) {
    const errors = payload?.userErrors || [];
    throw new Error(
      errors.map((error) => error?.message).filter(Boolean).join(", ") ||
        "Unable to create staged upload target",
    );
  }

  return stagedTarget;
};

const createShopifyFileFromStagedUpload = async (admin, stagedTarget, { fileName, altText }) => {
  const uploadFormData = new FormData();

  for (const parameter of stagedTarget.parameters || []) {
    uploadFormData.append(parameter.name, parameter.value);
  }

  const { mimeType, buffer } = await dataUrlToBuffer(stagedTarget.__proofDataUrl);
  const proofBlob = new Blob([buffer], { type: mimeType });
  uploadFormData.append("file", proofBlob, fileName);

  const uploadResponse = await fetch(stagedTarget.url, {
    method: "POST",
    body: uploadFormData,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Staged upload failed with status ${uploadResponse.status}`);
  }

  const fileCreateResponse = await admin.graphql(
    `#graphql
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          alt
          createdAt
          ... on MediaImage {
            image {
              url
            }
          }
          ... on GenericFile {
            url
          }
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    {
      variables: {
        files: [
          {
            alt: altText,
            contentType: "IMAGE",
            originalSource: stagedTarget.resourceUrl,
          },
        ],
      },
    },
  );

  const fileCreateResult = await fileCreateResponse.json();
  const fileCreatePayload = fileCreateResult?.data?.fileCreate;
  const createdFile = fileCreatePayload?.files?.[0] || null;
  const createErrors = fileCreatePayload?.userErrors || [];

  if (!createdFile || createErrors.length > 0) {
    throw new Error(
      createErrors.map((error) => error?.message).filter(Boolean).join(", ") ||
        "Unable to create Shopify file",
    );
  }

  return {
    id: createdFile.id || null,
    url: createdFile?.image?.url || createdFile?.url || stagedTarget.resourceUrl || null,
    status: createdFile.fileStatus || null,
  };
};

const storeProofFile = async (admin, { designRef, sideName, dataUrl }) => {
  const { mimeType, buffer } = await dataUrlToBuffer(dataUrl);
  const baseFileName = `${sanitizeFileStem(designRef || "proof")}-${sanitizeFileStem(sideName || "side")}`;
  const extension = mimeType === "image/svg+xml" ? "svg" : mimeType === "image/png" ? "png" : "bin";
  const fileName = `${baseFileName}.${extension}`;

  const stagedTarget = await stageProofUpload(admin, {
    fileName,
    mimeType,
    fileSize: buffer.byteLength,
  });

  stagedTarget.__proofDataUrl = dataUrl;

  try {
    return await createShopifyFileFromStagedUpload(admin, stagedTarget, {
      fileName,
      altText: `${designRef || "Proof"} ${sideName}`.trim(),
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to store Shopify file",
      url: stagedTarget.resourceUrl || null,
    };
  }
};

export async function action({ request }) {
  const { admin } = await authenticate.public.appProxy(request);

  const contentType = request.headers.get("content-type") || "";
  let payload = {};

  if (contentType.includes("application/json")) {
    payload = await request.json();
  } else {
    const formData = await request.formData();
    payload = Object.fromEntries(formData);
  }

  const sides = Array.isArray(payload?.sides) ? payload.sides : [];
  const sideProofs = {};

  for (const side of sides) {
    const sideName = String(side?.side || "").trim().toLowerCase();
    if (!sideName) continue;

    try {
      const dataUrl = await buildProofSvgDataUrl(side);
      const storedFile = await storeProofFile(admin, {
        designRef: payload?.designRef || "proof",
        sideName,
        dataUrl,
      });

      sideProofs[sideName] = {
        dataUrl,
        fileName: `${sanitizeFileStem(payload?.designRef || "proof")}-${sideName}.svg`,
        hasOverlay: String(side?.overlay || "").toLowerCase() !== "no",
        shopifyFileUrl: storedFile?.url || null,
        shopifyFileId: storedFile?.id || null,
        shopifyFileStatus: storedFile?.status || null,
      };
    } catch (error) {
      sideProofs[sideName] = {
        error: error instanceof Error ? error.message : "Unable to build proof",
        hasOverlay: String(side?.overlay || "").toLowerCase() !== "no",
      };
    }
  }

  return Response.json({
    ok: true,
    sideProofs,
    receivedKeys: Object.keys(payload || {}),
  });
}
