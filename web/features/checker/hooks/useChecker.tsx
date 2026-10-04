"use client";

import { createContext, useContext } from "react";
import type { ProbeConfig } from "@/features/probe/model/types";

export type CheckerState = {
  config: ProbeConfig | null;
  instance: number; // which shortener instance the experiments use
};

export const CheckerContext = createContext<CheckerState>({ config: null, instance: 0 });
export const useChecker = () => useContext(CheckerContext);
