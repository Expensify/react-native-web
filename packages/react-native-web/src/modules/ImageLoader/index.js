/**
 * Copyright (c) Nicolas Gallagher.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

const dataUriPattern = /^data:/;

export class ImageUriCache {
  static _maximumEntries: number = 256;
  static _entries = {};

  static has(uri: string): boolean {
    const entries = ImageUriCache._entries;
    const isDataUri = dataUriPattern.test(uri);
    return isDataUri || Boolean(entries[uri]);
  }

  static add(uri: string) {
    const entries = ImageUriCache._entries;
    const lastUsedTimestamp = Date.now();
    if (entries[uri]) {
      entries[uri].lastUsedTimestamp = lastUsedTimestamp;
      entries[uri].refCount += 1;
    } else {
      entries[uri] = {
        lastUsedTimestamp,
        refCount: 1
      };
    }
  }

  static remove(uri: string) {
    const entries = ImageUriCache._entries;
    if (entries[uri]) {
      entries[uri].refCount -= 1;
    }
    // Free up entries when the cache is "full"
    ImageUriCache._cleanUpIfNeeded();
  }

  static _cleanUpIfNeeded() {
    const entries = ImageUriCache._entries;
    const imageUris = Object.keys(entries);

    if (imageUris.length + 1 > ImageUriCache._maximumEntries) {
      let leastRecentlyUsedKey;
      let leastRecentlyUsedEntry;

      imageUris.forEach((uri) => {
        const entry = entries[uri];
        if (
          (!leastRecentlyUsedEntry ||
            entry.lastUsedTimestamp <
              leastRecentlyUsedEntry.lastUsedTimestamp) &&
          entry.refCount === 0
        ) {
          leastRecentlyUsedKey = uri;
          leastRecentlyUsedEntry = entry;
        }
      });

      if (leastRecentlyUsedKey) {
        delete entries[leastRecentlyUsedKey];
      }
    }
  }
}

let id = 0;
const requests = {};

const ImageLoader = {
  abort(requestId: number) {
    let image = requests[`${requestId}`];
    if (image) {
      image.onerror = null;
      image.onload = null;
      image = null;
      delete requests[`${requestId}`];
    }
  },
  getSize(
    uri: string,
    success: (width: number, height: number) => void,
    failure: () => void
  ) {
    let complete = false;
    const interval = setInterval(callback, 16);
    const { requestId } = ImageLoader.load({ uri }, callback, errorCallback);

    function callback() {
      const image = requests[`${requestId}`];
      if (image) {
        const { naturalHeight, naturalWidth } = image;
        if (naturalHeight && naturalWidth) {
          success(naturalWidth, naturalHeight);
          complete = true;
        }
      }
      if (complete) {
        ImageLoader.abort(requestId);
        clearInterval(interval);
      }
    }

    function errorCallback() {
      if (typeof failure === 'function') {
        failure();
      }
      ImageLoader.abort(requestId);
      clearInterval(interval);
    }
  },
  has(uri: string): boolean {
    return ImageUriCache.has(uri);
  },
  load(
    source: { uri: string },
    onLoad: Function,
    onError: Function
  ): LoadRequest {
    id += 1;
    const image = new window.Image();
    image.onerror = onError;
    image.onload = (nativeEvent) => {
      // avoid blocking the main thread
      const onDecode = () => {
        // Append `source` to match RN's ImageLoadEvent interface
        nativeEvent.source = {
          uri: image.src,
          width: image.naturalWidth,
          height: image.naturalHeight
        };

        onLoad({ nativeEvent });
      };
      if (typeof image.decode === 'function') {
        // Safari currently throws exceptions when decoding svgs.
        // We want to catch that error and allow the load handler
        // to be forwarded to the onLoad handler in this case
        image.decode().then(onDecode, onDecode);
      } else {
        setTimeout(onDecode, 0);
      }
    };
    image.src = source.uri;
    requests[`${id}`] = image;

    return {
      source,
      cancel: () => ImageLoader.abort(id),
      requestId: id
    };
  },
  loadWithHeaders(
    source: ImageSource,
    onLoad: Function,
    onError: Function
  ): LoadRequest {
    let loadRequest: LoadRequest;
    let uri: string;
    const abortCtrl = new AbortController();
    const request = new Request(source.uri, {
      headers: source.headers,
      signal: abortCtrl.signal
    });
    request.headers.append('accept', 'image/*');

    fetch(request)
      .then((response) => response.blob())
      .then((blob) => {
        uri = URL.createObjectURL(blob);
        loadRequest = ImageLoader.load({ uri }, onLoad, onError);
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && onError) {
          onError(error);
        }
      });

    return {
      source,
      get requestId() {
        if (loadRequest) return loadRequest.requestId;
        return -1;
      },
      cancel: () => {
        abortCtrl.abort();
        if (loadRequest) loadRequest.cancel();
        URL.revokeObjectURL(uri);
      }
    };
  },
  prefetch(uri: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ImageLoader.load(
        { uri },
        () => {
          // Add the uri to the cache so it can be immediately displayed when used
          // but also immediately remove it to correctly reflect that it has no active references
          ImageUriCache.add(uri);
          ImageUriCache.remove(uri);
          resolve();
        },
        reject
      );
    });
  },
  queryCache(uris: Array<string>): Promise<{| [uri: string]: 'disk/memory' |}> {
    const result = {};
    uris.forEach((u) => {
      if (ImageUriCache.has(u)) {
        result[u] = 'disk/memory';
      }
    });
    return Promise.resolve(result);
  }
};

export type LoadRequest = {|
  requestId: number,
  source: ImageSource | { uri: string },
  cancel: Function
|};

type ImageSource = {
  uri: string,
  headers: { [key: string]: string }
};

export default ImageLoader;
