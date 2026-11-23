/** The staged changes not yet published (the publish page and the nav's badge). */
import * as sdk from "@edgway/sdk";
import { useQuery } from "@tanstack/react-query";
import { call, client } from "../data-provider";

export const PENDING_KEY = ["config-pending"];

type Pending = sdk.PendingChangesResponses[200];
/** One staged change, as the admin types it. */
export type Change = Pending["changes"][number];

export const usePendingChanges = () =>
  useQuery({
    queryKey: PENDING_KEY,
    retry: 1,
    queryFn: async () =>
      (await call(sdk.pendingChanges({ client }))) as Pending,
  });
