import { authenticate } from "../shopify.server";

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

  const {
    items = [],
    note,
    title,
    quantity,
    unitPrice,
    variantId,
    currencyCode,
  } = payload;

  const normalizedItemsInput =
    Array.isArray(items) && items.length > 0
      ? items
      : title || variantId
        ? [
            {
              title,
              quantity,
              unitPrice,
              variantId,
              currencyCode,
            },
          ]
        : [];

  if (
    !Array.isArray(normalizedItemsInput) ||
    normalizedItemsInput.length === 0
  ) {
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
  const fallbackCurrencyCode = String(currencyCode || "USD").toUpperCase();

  for (let index = 0; index < normalizedItemsInput.length; index += 1) {
    const item = normalizedItemsInput[index] || {};
    const itemVariantId = item.variantId;
    const itemTitle = item.title;
    const itemCurrencyCode = String(
      item.currencyCode || fallbackCurrencyCode,
    ).toUpperCase();
    const parsedQuantity = Number(item.quantity ?? 1);
    const parsedUnitPrice = Number(item.unitPrice ?? 0);

    if (!itemVariantId && !itemTitle) {
      userErrors.push({
        field: ["items", String(index), "variantId"],
        message: "Either variantId or title is required",
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

    if (
      !itemVariantId &&
      (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice <= 0)
    ) {
      userErrors.push({
        field: ["items", String(index), "unitPrice"],
        message: "Unit price must be greater than 0 for custom line items",
      });
      continue;
    }

    if (itemVariantId) {
      const variantLineItem = {
        variantId: itemVariantId,
        quantity: Math.round(parsedQuantity),
      };

      if (Number.isFinite(parsedUnitPrice) && parsedUnitPrice > 0) {
        variantLineItem.priceOverride = {
          amount: parsedUnitPrice.toFixed(2),
          currencyCode: itemCurrencyCode,
        };
      }

      normalizedLineItems.push(variantLineItem);
      continue;
    }

    normalizedLineItems.push({
      title: itemTitle,
      quantity: Math.round(parsedQuantity),
      originalUnitPriceWithCurrency: {
        amount: parsedUnitPrice.toFixed(2),
        currencyCode: itemCurrencyCode,
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
