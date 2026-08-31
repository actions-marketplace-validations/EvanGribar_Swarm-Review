import test from "node:test";
import { runOfflineSpecBridgeValidation } from "./specbridge-offline-validation.js";

test("offline SpecBridge validation exercises structured evaluation through artifacts", async () => { await runOfflineSpecBridgeValidation(); });
