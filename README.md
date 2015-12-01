# HTTP/2 Push を Service Worker + Cache Aware Server Push で効率化する

http2study の分かってる人にとっては、「casper の JS 版を作った」だけで伝わるかもしれませんが、そうでない場合非常に話すべきことがたくさん有る気がするので、順を追って説明します。

今回理解すべき内容は以下

- http2 push の問題点
- cache aware server push
- bloom filter と golomb coded set
- cache fingerprinting
- dispenser.js

(最初は casper.js と言ってたけど、よく考えると被ってるのがあるので dispenser.js に変えました)


# http2 push の問題点

http2 で push することで、リソースをブラウザにキャッシュしてキャッシュヒットさせる、というユースケースについてはもう散々語られたと思うので、それは前提とします。

問題は、例えば index.html へのリクエストで script.js を push する設定をした場合に、サーバは毎回 script.js を push しては無駄なわけです。
もしすでに push 済みであれば、 push しないで index.html に対するレスポンスを返し、 script.js を速やかにリクエストさせてキャッシュヒットさせたい。

問題はつまりこういうことです。


> ブラウザが何をキャッシュとして持っているか、サーバが知る方法が無い


ブラウザのキャッシュを取得できると、閲覧履歴などがわかってしまい問題となる可能性もあるため、基本的にこういうことをする API はありません。


# cache aware server push

そこで kazuho さんは、 push 済みのリソースの情報を Cookie に付与しておくことで、次のリクエストで 「index.html が欲しいけど scirpt.js はもうキャッシュに有るから push しないでいいよ」という情報をクライアントから取得するという方法を考えました。

これが [Cache Aware Server Push](https://github.com/h2o/h2o/issues/421) という方式です。

では、実際 cookie には何の情報を入れればいいでしょうか？


例えば、 script.js を Push したら Cookie にも "script.js" って書けばいいかもしれません。
しかし、それだとキャッシュされた script.js よりも、サーバが持っている script.js が新しく更新された場合に、「新しくなったから更新」ということができません。

それは、ファイルのバージョンを示すのに使われる Etag の値を一緒に載せればわかるでしょう。

```
/assets/scripts/script.js:zidr965q3jalsfda4
```

でもこれでは、ファイルパスや Etag が長くて、さらにファイルが何個もあったら、すぐに膨らんでしまいます。
Cookie は他にも多くの情報を入れるために使われるので、サブリソースが多くなりがちな昨今ではちょっと辛いです。

そこで、この情報をうまく圧縮する必要があります。


# false positive

ファイルパスと Etag があれば十分ではありますが、本当に全部入れる必要はあるでしょうか？
そもそも、ブラウザのキャッシュなんていつ消えるかわかりません。 Cookie がそれと完全に同期するのがそもそも無理です。

したがって 100% は無理なので、そこを狙う必要は無く、もし当てが外れても以下の二通りになります。

- 「キャッシュされてると思って Push しなかったら、されてなかった」=> ブラウザが普通に GET するだけ
- 「キャッシュされてないと思って Push したら、されてた」 => キャッシュが上書きされるだけ

つまり Push は読みが外れても動かなくなるものではありません。

しかし、かといって毎回 Push しまくってはせっかくのキャッシュで 0 RTT hit させられるのに無駄です。
狙いは、「なるべく無駄な Push を減らす」ことです、すると本質的に必要な情報は以下になります。


> 「今から Push しようとしているファイルは、すでにキャッシュに *有りそうかどうか？* (あるとはいってない)」


100% でなくてもよい(あると思ったら無かった=false positive が許される)、となると実は情報を圧縮する方法がいくつかあります。
その代表例が確率的データ構造である bloom fileter です。


# bloom filter

bloom filter については [こちら](http://dev.ariel-networks.com/column/tech/boom_filter/) 説明あたりがわかりやすいと思います。

簡単に言えば、その構造体の中に特定のデータが含まれているかどうかを検査を、元のデータセットより小さいサイズで実現できます。

具体的には k 個のハッシュ関数を用意し、要素をそのハッシュにかけます。
そこ結果を、求めるデータサイズ m ビットで丸めると、 0~m の範囲の値が一要素につき k 個得られます。
ゼロクリアした m bit の値に対し、それぞれの値の場所(3 なら 3bit 目)を 1 にします。
全ての要素でこれを繰り返せば完成です。


ある要素がそこに入ってるかを検証するには、同じくハッシュを通してビットが立ってるかを調べます。

この場合、全部のビットが立ってなければ確実に無いことがわかります。
しかし、全部のビットが立っていても、それが他の要素の計算による可能性があるわけです。
これが "False Positive" = 「Positive(ある) と思ったら False(嘘) だった」です。


Bloom Filter は

- 要素数(ファイルの数) = n
- ハッシュ関数の数(要素ごとに立つビットの数) = k
- 結果のビット数 = m

とすると

```
誤検出の確率 = (1 - e*p(-float(k * n) / m)) ** k
m = -n*ln(p) / (ln(2)^2)
k = m/n * ln(2)
```

の関係がわかっています。
HTTP のペイロードに載せることを考えれば、計算量よりもデータサイズが小さいことが望ましいため、許容できる誤検出を元に、これを最適化することができます。

ただし、計算量を追加することで、より論理的な限界までこれを圧縮するというのが Golomb Coded Set(GCS) です。

- https://en.wikipedia.org/wiki/Bloom_filter
- http://corte.si/posts/code/bloom-filter-rules-of-thumb/
- http://hur.st/bloomfilter?n=4&p=1.0E-20
- http://pages.cs.wisc.edu/~cao/papers/summary-cache/node8.html
- http://stackoverflow.com/questions/658439/how-many-hash-functions-does-my-bloom-filter-need


## Golomb Coded Set(GCS)

Golomb-coded set  は、ほぼ [ここ](http://giovanni.bajo.it/post/47119962313/golomb-coded-sets-smaller-than-bloom-filters) に書かれた通りなのでそれを元に紹介。


まずターゲットが以下の値(N=26)だとします。


```
['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike',
 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra',
 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee',
 'zulu']
```

これを P=64 (誤検出が64回に1回) になるようにします。

ハッシュ関数は、セキュリティ面で言われる危殆化が関係ないため、 MD5 や SHA1 などで構いません。
求めた値が `[0, N*P)` = `[0, 1664)`  に収まるように mod で丸め込むと、

```
[('alpha', 1017), ('bravo', 591), ('charlie', 1207)...]
```


このハッシュ部分だけをソートして


```
[151, 192, 208, ..., 1630]
```

このとき、ハッシュの質が良ければ、結果は `[0, 1664)` に一様分布するはずです。

そして、それぞれの値の間の距離をとると以下になります。

```
[151, 41, 16, 61, ...]
```

26 個の値を `26*64` の間に分布させたので、距離の平均は 64 になるはずです。
つまり、この距離の配列の中には、 *多くの 64 近い値* と、*少しの 64 と遠い値* があるはずです。
(実際、 64 との差の絶対値をプロットするとわかる)


Golomb Coded Set は、この性質を利用して、配列を圧縮します。

まず、この配列の各値を 64 で割ると、多くの商は 0, 1, 2 あたりになります。(最悪 25 だがそれはハッシュ関数を見直した方が良い)

で、その商を Unary Encoding(商の数だけ 0 の前に 1 をつける) します。
具体的には、こうです。

```
商   Unary encoding
 0   0
 1   10
 2   110
 3   1110
 4   11110
 5   111110
 6   1111110
```

これに余り(0~63) をそのまま 6bit バイナリとして加えると、

```
距離  商  余   Golomb encoding
151    2  23      110 010111
 41    0  41        0 101001
 16    0  16        0 010000
 61    0  61        0 111101
192    3   0     1110 000000
 51    0  51        0 110011
.
.
```

結果の長さは、

-   0~63  は   0+6bit で 7bit
-  64~127 は  10+6bit で 8bit
- 128~191 は 110+6bit で 9bit

なので、 64 に近い値が多いという前提であれば、これで多くの値が小さくエンコードできることがわかります。



結果を全部つなげると完成です。

```
11001011 10101001 00100000 11110111 10000000 0110011...
```


元に戻すには 0 がくるまで 1 を並べ、その後固定長(ここでは 6bit) とって逆算すれば、順番にハッシュが取得できます。


これが基本的なアイデア。


# cache aware server push と casper cookie

で、 kazuho さんはこれを使って push 済みのファイル(Path+Etag)情報を圧縮し、 Cookie につけてクライアントに送る。クライアントから来る Cookie の情報から Push するかしないかを判断するという方法を、 h2o に実装しました。

その Cookie を casper cookie と言います。

現在 [h2o のデモページ](https://h2o.examp1e.net/) ではその Cookie が付与されています。


で、 kazuho さんがこの方法を 10月の [#http2study](http://http2study.connpass.com/event/21161/) httpbis ガチ勢の前でデモした結果大好評となり、「これは Cookie より別途ヘッダがあった方がいい」「ドラフト書け」みたいな話になって kazuho さんが書いたドラフトが以下です。


[Cache fingerprinting for HTTP](http://kazuho.github.io/http-cache-fingerprint/)


# cache fingerprinting

Cache Fingerprinting では、以下の二つのヘッダが定義されています。

- Cache-Fingerprint-Key
- Cache-FIngerprint


## Cache-Fingerprint-Key

この値が、各ファイルごとのハッシュ値になります。
casper cookie の頃は、 Path+Etag の sha1 hash でしたが、
この値を別のロジックで出すことで最適化できる可能性もあるため、
仕様上この値の導出は明記されていません。実装依存です。

値が uint32 (0~2^32) までとだけ定義されています。


## Cache-Fingerprint Header Field

クライアントはキャッシュしたレスポンスの fingerprint key を集め、 Golombset でエンコードした結果を Cache-Fingerprint ヘッダで送ることで、サーバにキャッシュしているファイルを伝えることができます。

リクエストヘッダなので、通常はブラウザが実装することが想定されます。

(注意: このブログを書いてる最中に、フレームが良いということになって、ドラフトは http2 に拡張フレームを定義しています)



# dispenser.js

やっと本題です。

ブラウザが実装するまでは、このヘッダは使えないので、 h2o は Cookie にも fingerprint を吐いていますが、 Cookie はブラウザキャッシュとは同期させられません。

そこで、 Service Worker がブラウザキャッシュの代わりに Cache API でキャッシュを管理し Fingerprint を計算、リクエストを Proxy しヘッダに追加して行けば、より正確にキャッシュの管理ができ、無駄な Push を減らせるということで作ったのが dispenser.js です。


## 動作

基本の流れはこうです。

- 最初のリクエストでサーバは全てのサブリソースを Push する
- Service Worker を登録する
- 次のリクエストは SW で interapt する
- SW は fetch を発行し、それがブラウザキャッシュヒットする
- 取得したレスポンスを Cache API で保存し、返す
- それ以降のリクエストは、 Cache に無いものだけ、キャッシュしたレスポンスのヘッダから fingerprint を計算してヘッダに足す

これにより、 SW で発行した fetch がブラウザキャッシュにヒットしたときに Cache API に移され、ブラウザキャッシュを JS で管理している状態に近づけます。
また、サーバにキャッシュの情報を正確に伝えることで、無駄な Push を減らすことができます。


## 実装

ここです。





## 知見

ということで作って検証していたのですが、色々と課題が出てしまいました。。


### SW 内の fetch はブラウザキャッシュヒットしない

これ、すると思ってたのですが、現状していません。これでは Push したリソースを fetch でキャッシュヒットさせて SW 内の Cache に引き込むことができません。大前提が。。

今後 Push API が http2 push を受けられるようになったりすればまた少し変わりますが、もしかしたらフロントの fetch でキャッシュヒットさせて SW に送り込むとかしないといけないかもしれません。

それもまだ未検証です。


### Chrome Canary だと onfetch でフックした Request を引数に new Request すると怒られる

Stable ではできているのですが、 Canary だと怒られます。つまりそのうち使えなくなる可能性が。
ブラウザからのリクエストを雑に複製するのは簡単なのですが、このスクリプトが casper 対応サーバで無条件にホストして良いレベルの汎用スクリプトにするためには、複製した Request はオリジナルと限りなく近い必要があります。

そもそもなんで動かなくなったのか？(仕様変更か実装の話か) などもう少し調べる必要があります。


### https://localhost 開発問題

http2 なので開発も https でやっています。オレオレ証明書で https://localhost を許可するわけですが、この場合 invalid cert なので、 SW の register がエラーになります。

現状これを回避する方法は、全ての証明書エラーを無視するという、ちょっとデンジャラスな起動オプションを使う必要があります。
有効にした場合、開発中に同じブラウザでググるみたいなのが総じて危険になるため、本当はより正しいやり方があるのですが、その正しいやり方の方が Chrome のバグで動きません。

デンジャラスな方が広まると良く無いのでここには書きません。

バグは issue を上げてあるので、直ったら追記したり呟いたりします。


### Chrome ではリロードとナビゲートでキャッシュの扱いが違う

[@kinu](https://twitter.com/kinu/) さんに教えてもらったのですが

- リロード(CTL+R) では、ブラウザキャッシュは無視して必ずサーバにリクエスト
- ナビゲート(CTL+L Enter) は、ブラウザキャッシュがあればキャッシュヒット

なので、この開発中は CTL+R で更新してたので、非常にハマりました。


https://twitter.com/kinu/status/669432544178380806


### Push されたことを確実に知る方法

cache hit すると DevTools の NetWork タブで `from cache` みたいな感じで出ますが、より正確に知るためには `chrome://net-internal` で http2 のセッションを見るしか無いようです。


例えば index.html が 1.css, 2.css を含み、 CSS は PUSH している場合以下のようになります(抜粋)
1.css, 2.css は PUSH_PROMISE で送られていて、二つに対する SEND_HEADERS が書かれてなければ、キャッシュヒットしています。


```
t=1386045 [st=    0]    HTTP2_SESSION_SEND_HEADERS
                        --> fin = true
                        --> :authority: 127.0.0.1:3000
                            :method: GET
                            :path: /main.html
                            :scheme: https
                        --> priority = 0
                        --> stream_id = 1
                        --> unidirectional = false
t=1386045 [st=    0]    HTTP2_SESSION_RECV_PUSH_PROMISE
                        --> :authority: 127.0.0.1:3000
                            :method: GET
                            :path: /1.css
                            :scheme: https
                        --> id = 1
                        --> promised_stream_id = 2
t=1386045 [st=    0]    HTTP2_SESSION_RECV_HEADERS
                        --> fin = false
                        --> :status: 200
                            accept-ranges: bytes
                            cache-fingerprint-key: 7351
                            content-length: 23
                            content-type: text/css
                            etag: "5643ea29-17"
                            last-modified: Thu, 12 Nov 2015 01:23:53 GMT
                            server: h2o/1.6.0-beta1
                            x-http2-push: pushed
                        --> stream_id = 2
t=1386045 [st=    0]    HTTP2_SESSION_RECV_PUSH_PROMISE
                        --> :authority: 127.0.0.1:3000
                            :method: GET
                            :path: /2.css
                            :scheme: https
                        --> id = 1
                        --> promised_stream_id = 4
t=1386045 [st=    0]    HTTP2_SESSION_RECV_HEADERS
                        --> fin = false
                        --> :status: 200
                            accept-ranges: bytes
                            cache-fingerprint-key: 4710
                            content-length: 27
                            content-type: text/css
                            etag: "5654b166-1b"
                            last-modified: Tue, 24 Nov 2015 18:50:14 GMT
                            server: h2o/1.6.0-beta1
                            x-http2-push: pushed
                        --> stream_id = 4
t=1386046 [st=    1]    HTTP2_SESSION_RECV_HEADERS
                        --> fin = false
                        --> :status: 200
                            accept-ranges: bytes
                            content-length: 7774
                            content-type: text/html
                            etag: "565e3110-1e5e"
                            last-modified: Tue, 01 Dec 2015 23:45:20 GMT
                            link: </1.css>; rel=preload</2.css>; rel=preload
                            server: h2o/1.6.0-beta1
                            set-cookie: [64 bytes were stripped]
                        --> stream_id = 1
t=1396049 [st=10004]    HTTP2_SESSION_GOAWAY
                        --> active_streams = 1
                        --> last_accepted_stream_id = 1
                        --> status = 0
                        --> unclaimed_streams = 1
```


これを見やすくするツールが一応あるようです。

https://github.com/rmurphey/chrome-http2-log-parser


Chrome には表示を追加する issue があるようです。

https://code.google.com/p/chromium/issues/detail?id=464501


## まとめ

本当は「作りました！」で効果測定の結果などを書きたかったですが、そこまで行けませんでした。

HTTP2 Push も Service Worker もまだまだ研究の余地が一杯あるなということで、地道に頑張ります。

Jxck
