# Optional developer tool image. This is not bundled into Mother or run automatically.
FROM kalilinux/kali-rolling
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends nmap ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
USER nobody
ENTRYPOINT ["nmap"]
CMD ["--version"]
