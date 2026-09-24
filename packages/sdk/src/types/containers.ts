/**
 * A host that can run another host inside a container.
 *
 * The port is the launcher's whole surface: whether a container can be made at
 * all, making one for a workspace folder and starting a host inside it, writing
 * one frame to that host, and stopping the relay. What a frame *means* is not
 * here - the SDK owns the protocol, and this owns processes.
 *
 * A container is a workspace's own `devcontainer.json`, made by the Dev
 * Container CLI, so the port is a `devcontainer` client and not a Docker one:
 * Docker is what it reaches through, and the file is what it obeys. Decision
 * `a-dev-container-is-made-by-the-dev-container-cli`.
 */

/** What a client asks for: one connection, one folder, one name for it. */
export interface ContainerConnect {
  /**
   * The client's own name for this connection.
   *
   * Handed back with every frame and every close, so a client holding two
   * containers can tell them apart. It is not unique across clients: the host
   * keeps one map per connection, which is where the reference host puts it
   * too - decision `the-relay-surface-is-the-reference-one`.
   */
  connectionId: string;
  /**
   * The folder whose `devcontainer.json` this is.
   *
   * An absolute path on this host. It is the container definition as well as
   * the folder a session inside it starts in.
   */
  workspaceFolder: string;
  /** What the client calls this container on screen. */
  name: string;
}

/** What a client is told once the container is up and a host is running in it. */
export interface ContainerConnectResult {
  /**
   * Where the nested host is, as a name a client shows and stores.
   *
   * `devcontainer:<containerId>`, which is the reference's own spelling. It is
   * not something a client can dial: the frames arrive through this host.
   */
  address: string;
  /** The workspace folder as the container sees it. */
  remoteWorkspaceFolder: string;
  /** The same folder as this host knows it, when the launcher knows it. */
  hostWorkspaceFolder?: string;
}

/**
 * What a port says while a container comes up and while it runs.
 *
 * Given to `connect` rather than returned by it, because a container says
 * things before it is ready: the CLI prints what it is doing, and a person
 * waiting for an image to build should see it.
 */
export interface ContainerSink {
  /** One frame from the host inside the container, exactly as it wrote it. */
  message(text: string): void;
  /** The launcher's or the nested host's own output, for a person watching. */
  output(text: string): void;
  /** The relay ended. The reason is absent when it was simply stopped. */
  close(reason?: string): void;
}

/**
 * A launcher for containers, as a host option or a plugin's contribution.
 *
 * Every member is a promise or a plain answer, and none of them throws for a
 * state a client can be told about: a container that cannot be made is a
 * refusal with a sentence, which is what the caller reports.
 */
export interface ContainerPort {
  /**
   * Whether Docker can be resolved from this host's environment.
   *
   * The question the reference client asks by that name, and nothing more: the
   * CLI is a second fact, and answering both here would make a host with Docker
   * look like a host with no Docker at all.
   */
  docker(): Promise<boolean>;
  /**
   * Whether a container can be made here at all.
   *
   * Both facts: Docker resolves, and the Dev Container CLI does. This is what
   * the capability key follows, so a host that has Docker and not the CLI
   * advertises nothing and is never asked to make one.
   */
  available(): Promise<boolean>;
  /**
   * Make or find the container for a folder, and start a host inside it.
   *
   * Answers once the host is running and the channel is open; everything it
   * said on the way, and everything the host says afterwards, arrives on
   * `sink` until `close`. A failure is a refusal with a sentence, and nothing
   * is left running when it throws.
   */
  connect(options: ContainerConnect, sink: ContainerSink): Promise<ContainerConnectResult>;
  /** Write one frame to the host inside this connection's container. */
  send(connectionId: string, data: string): void | Promise<void>;
  /**
   * Stop one connection's relay: end the host, release the channel.
   *
   * The container itself is the CLI's to keep, as it is in the reference host:
   * what ends here is the relay, which is this host's own process.
   */
  disconnect(connectionId: string): void | Promise<void>;
}
