import { authenticate } from "../shopify.server";

export async function action({ request }) {
  const { admin } = await authenticate.public.appProxy(request);

  let payload = {};

  try {
    payload = await request.json();
  } catch {
    const formData = await request.formData();
    payload = Object.fromEntries(formData);
  }

  const { items = [], note } = payload;

  if (!Array.isArray(items) || items.length === 0) {
    return Response.json(
      {
        draftOrder: null,
        userErrors: [
          { field: ["items"], message: "At least one line item is required" },
        ],
      },
      { status: 400 },
    );
  }

  const normalizedLineItems = [];
  const userErrors = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const variantId = item.variantId;
    const parsedQuantity = Number(item.quantity ?? 1);
    const parsedUnitPrice = Number(item.unitPrice ?? 0);

    if (!variantId) {
      userErrors.push({
        field: ["items", String(index), "variantId"],
        message: "Variant ID is required",
      });
      continue;
    }

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      userErrors.push({
        field: ["items", String(index), "quantity"],
        message: "Quantity must be greater than 0",
      });
      continue;
    }

    if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice <= 0) {
      userErrors.push({
        field: ["items", String(index), "unitPrice"],
        message: "Unit price must be greater than 0",
      });
      continue;
    }

    normalizedLineItems.push({
      variantId,
      quantity: Math.round(parsedQuantity),
      priceOverride: {
        amount: parsedUnitPrice.toFixed(2),
        currencyCode: "USD",
      },
    });
  }

  if (userErrors.length > 0) {
    return Response.json(
      {
        draftOrder: null,
        userErrors,
      },
      { status: 400 },
    );
  }

  try {
    const response = await admin.graphql(
      `#graphql
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            name
            invoiceUrl
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
              }
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
          input: {
            note,
            lineItems: normalizedLineItems,
          },
        },
      },
    );

    const result = await response.json();
    const draftOrderPayload = result?.data?.draftOrderCreate;

    return Response.json({
      draftOrder: draftOrderPayload?.draftOrder || null,
      invoiceUrl: draftOrderPayload?.draftOrder?.invoiceUrl || null,
      userErrors: draftOrderPayload?.userErrors || [],
    });
  } catch (error) {
    console.error("Draft order create failed:", error);

    return Response.json(
      {
        draftOrder: null,
        userErrors: [
          {
            field: ["server"],
            message:
              error instanceof Error ? error.message : "Unknown server error",
          },
        ],
      },
      { status: 500 },
    );
  }
}
