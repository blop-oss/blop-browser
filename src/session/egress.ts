export type InternetEgressProbeDisclosure = {
  enabled: boolean;
  destination: "https://1.1.1.1:443" | null;
};

export type ContainerIdentityCache<T> = {
  getOrCreate: (
    containerName: string,
    containerId: string,
    create: () => Promise<T>,
  ) => Promise<T>;
  delete: (containerName: string) => void;
  clear: () => void;
};

export function createContainerIdentityCache<T>(): ContainerIdentityCache<T> {
  const entries = new Map<string, { containerId: string; value: Promise<T> }>();
  return {
    getOrCreate(containerName, containerId, create) {
      const cached = entries.get(containerName);
      if (cached?.containerId === containerId) return cached.value;
      const value = Promise.resolve().then(create);
      entries.set(containerName, { containerId, value });
      void value.catch(() => {
        if (entries.get(containerName)?.value === value) entries.delete(containerName);
      });
      return value;
    },
    delete(containerName) {
      entries.delete(containerName);
    },
    clear() {
      entries.clear();
    },
  };
}

export function resolveInternetEgressProbe(
  enabled = false,
): InternetEgressProbeDisclosure {
  return enabled
    ? { enabled: true, destination: "https://1.1.1.1:443" }
    : { enabled: false, destination: null };
}
