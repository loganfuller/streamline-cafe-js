FROM ubuntu:24.04
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb xauth libgtk-3-0t64 libsecret-1-0 libjsoncpp25 libserialport0 liblzma5 libglu1-mesa \
    dbus dbus-x11 avahi-daemon ca-certificates curl libegl1 libgles2 libgl1-mesa-dri libegl-mesa0 \
    tzdata unzip \
 && rm -rf /var/lib/apt/lists/*
