# casper.js を作った、または Cache Aware Server Push を用いた HTTP/2 Push の効率化

分かってる人にとっては、「casper.js を作った」だけで伝わるかもしれませんが、そうでない場合非常に話すべきことがたくさん有る気がするので、順を追って説明します。

今回理解すべき内容は以下


- http2 push の問題点
- cache aware server push
- bloom filter と golomb coded set
- cache fingerprinting
- casper.js


# http2 push の問題点

http2 で push することで、リソースをブラウザにキャッシュしてキャッシュヒットさせる、というユースケースについてはもう散々語られたと思うので、それは前提とします。

問題は、例えば index.html へのリクエストで script.js を push する設定をした場合に、サーバは毎回 script.js を push しては無駄なわけです。
もしすでに push 済みであれば、 push しないで index.html に対するレスポンスを返し、 script.js を速やかにリクエストさせてキャッシュヒットさせたい。

問題はつまりこういうことです。

> ブラウザが何をキャッシュとして持っているか、サーバが知る方法が無い


ブラウザのキャッシュを取得できると、閲覧履歴などがわかってしまい問題となる可能性もあるため、基本的にこういうことはできません。


# cache aware server push

そこで、例えばサーバが script.js を Push をしたあとに、その事実を index.html の Cookie に付与しておけば、次のリクエストでは 「index.html が欲しいけど scirpt.js はもうキャッシュに有るから push しないでいいよ」という情報がとれます。

これによって、無駄な Push を減らそうというのが、 kazuho さんの考えた Cache Aware Server Push という方式です。

では、実際 cookie には何の情報を入れればいいでしょうか？


例えば、 script.js を Push したら "script.js" って書けばいいかもしれません。
しかし、それだとキャッシュされた script.js よりも、サーバが持っている script.js が新しく更新された場合に、「新しくなったから更新」ということができません。

そこで、ファイルのバージョンを示すのに使われる Etag の値を一緒に載せると良さそうです。

こんな感じでしょうか。

```
/assets/scripts/script.js:zidr965q3jalsfda4
```

でもこれ、ファイルパスや Etag が長くて、さらにファイルが何個もあったら、すぐに膨らんでしまいます。
Cookie は他にも多くの情報を入れるために使われるので、ちょっと辛いですね。

そこで、この情報をうまく圧縮することを考えます。


# false positive

ファイルパスと Etag があれば十分ではありますが、本質的に欲しい情報は何かと言うと

「今から Push しようとしているファイルは、すでにキャッシュに有るかどうか？」です。

ところで 100% わからないとダメでしょうか？
そもそも、ブラウザのキャッシュなんていつ消えるかわかりません。 Cookie がそれと完全に同期するのがそもそも無理です。

そして、もし当てが外れても以下の二通りです。

- 「キャッシュされてると思って Push しなかったら、されてなかった」=> ブラウザが普通に GET するだけ
- 「キャッシュされてないと思って Push したら、されてた」 => キャッシュが上書きされるだけ

実は Push は読みが外れても動かなくなるものではありません。しかしどっちにせよ無駄な処理は減らしたいです。
つまり狙い目は、「なるべく無駄な Push を減らす」ことであり、そうすると本当に欲しい情報はこうです。


「今から Push しようとしているファイルは、すでにキャッシュに *有りそうかどうか?*」


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

https://en.wikipedia.org/wiki/Bloom_filter
http://corte.si/posts/code/bloom-filter-rules-of-thumb/
http://hur.st/bloomfilter?n=4&p=1.0E-20
http://pages.cs.wisc.edu/~cao/papers/summary-cache/node8.html
http://stackoverflow.com/questions/658439/how-many-hash-functions-does-my-bloom-filter-need

## Golomb Coded Set(GCS)

Golomb-coded set  は、ほぼ [ここ](http://giovanni.bajo.it/post/47119962313/golomb-coded-sets-smaller-than-bloom-filters) に書かれた通りなのでそれを元に紹介。


まずターゲットが以下の値(N=26)だとする。

```
['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike',
 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra',
 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee',
 'zulu']
```

これを P=64 (誤検出が64回に1回) になるようにする。

ハッシュ関数は、セキュリティ面で言われる危殆化が関係ないため、 MD5 や SHA1 などで構わない。
求めた値が `[0, N*P)` = `[0, 1664)`  に収まるように mod で丸め込む。

```
[('alpha', 1017), ('bravo', 591), ('charlie', 1207)...]
```


このハッシュ部分だけをソートする。


```
[151, 192, 208, ..., 1630]
```

ハッシュの質が良ければ、結果は `[0, 1664)` に一様分布するはず。

そして、それぞれの値の間の距離をとると以下になる。

```
[151, 41, 16, 61, ...]
```

26 個の値を `26*64` の間に分布させたので、距離の平均は 64 になるはず。
(実際計算してもなる)

すると、この配列の中には、多くの 64 近い値と、少しの 64 と遠い値があるはずである。
(実際、 64 との差の絶対値をプロットするとわかる)


Golomb Coded Set は、この性質を利用して、配列を圧縮する。

まず、この配列の各値を 64 で割る。多くの商は 0, 1, 2 あたりになる。(最悪 25 だがそれはハッシュ関数を見直した方が良い)

で、その商を Unary Encoding する。
具体的には、こう。

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

商の数だけ 0 の前に 1 をつける。


これに余り(0~63) をそのまま 6bit バイナリとして加える。


  0~63  は   0+6bit で 7bit
 64~127 は  10+6bit で 8bit
128~191 は 110+6bit で 9bit

64 に近い値が多いという前提であれば、これで多くの値が小さくエンコードできることがわかるはずである。

個の値を求めて

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

全部つなげれば良い

```
11001011 10101001 00100000 11110111 10000000 0110011...
```


元に戻すには 0 がくるまで 1 を並べ、その後固定長(ここでは 6bit) とって逆算すれば、順番にハッシュが取得できる。




これが基本的なアイデア。


[翻訳](http://qiita.com/Jxck_/private/aae8afc5ec9ee7518197)


# cache aware server push と casper cookie

で、 kazuho さんはこれを使って push 済みのファイル(Path+Etag)情報を圧縮し、 Cookie につけてクライアントに送る。クライアントから来る Cookie の情報から Push するかしないかを判断するという方法を思いつき、それを h2o に実装しました。

これが Cache Aware Server Push と呼ばれる手法で、その Cookie を casper cookie と言います。

実際 h2o のデモページではその Cookie が付与されていました。


この方法を #http2study でやった 「http2/quic meetup」でデモしました。その場には
httpbis の chair (http2 の一番エラい人) である mnot
chrome に quic を実装してる jana
firefox に http2 を実装した martin
protocol sec のヤバい人 EKR
etc とガチ勢中のガチ勢がいたのですが、でデモしたところ大好評となりました。

そこで「これは Cookie より別途ヘッダがあった方がいい」「ドラフト書け」みたいな話になって kazuho さんが書いたドラフトが Cache fingerprinting for HTTP です。


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


# Cache-Fingerprint Header Field

user agent はキャッシュしたレスポンスの fingerprint key を集め、計算した結果を Cache-Fingerprint ヘッダで送ることで、サーバにキャッシュしているファイルを伝えることができます。

計算方法は以下です。

1. collect the values of "Cache-Fingerprint-Key" header fields from all the cached responses of the same origin
2. if number of collected keys is zero (0), go to step 10
3. algebraically sort the collected keys
4. determine the parameter of Golomb-Rice coding to be used [Golomb].[Rice]. The value MUST be a power of two (2), between one (1) to 2147483648.
5. calculate log2 of the parameter determined in step 4 as a 5-bit value
6. encode the first key using Golomb-Rice coding with parameter determined in step 4
7. if number of collected keys is one (1), go to step 9
8. for every collected key expect for the first key, encode the delta from the previous key minus one (1) using Golom-Rice coding with parameter determined in step 4
9. concatenate the result of step 4, 6, 8
10. if number of bits contained in the result of step 9 is not a multiple of eight (8), append a bit set until the length becomes a multiple of eight (8)


1. キャッシュしたレスポンスの Cache-Fingerprint-Key ヘッダを集める
2. キャッシュが無かったら 10 へ
3. キーを数値順でソートする
4. Golomb-Rice coding で使うパラメータを決定する。 値は 2 の累乗かつ 1~2^31 の範囲とすべき
5. step 4 で求めたパラメータの log2 を 5-bit 値として計算する
6. 最初のキーを step 4 で求めたパラメータを使い Golomb-Rice でエンコードする
7. key の数が 1 つなら step 9 へ
8. 最初のキーを除いた全てのキーにおてい、前の値との差分を計算し、 -1 した値を、 step 4 で求めたパラメータを使い Golomb-Rice コーディングでエンコードする。
9. 4, 6, 8 の結果を連結する。
10. step 9 の結果の bit の数が 8 の倍数じゃない場合、 8 の倍数になるまで bit を追加する。

TODO: 9 は 5,6,8?


"Cache-Fingerprint-Key" が無かったら、空の値を送る。

もし key が `[115, 923]` で、パラメータが `256` だった場合はこうなる。



```
115, 923
```

parameter 256

例として、 Cache-Fingerprint-Key として `115, 923` の二つがありパラメータを 256(2^8) とした場合。

log2(256) = 8


値の距離を計算すると

```
[115, 808]
```

二番目以降は -1 する
(元の golombset のブログでは -1 してないが、距離の最小値は 1 なので引いている)


```
[115, 807]
```

それぞれを 256 で割る

```
115 / 256 = 0...115
807 / 256 = 3... 39

   u  bit
   0  0111,0011
1110  0010,0111
```


この値と、 log2(256)=8 を 5bit にした 01000 を連結し、最後が 8 の倍数になるまで 1 を追加する。


```
0100,0001,1100,1111,1000,1001,1111,1111
8-----115-------807-------------pad----
```

結果これが求まる。

```
41 cf 89 ff    (16)
65 207 137 255 (10)
```

これを文字列にシリアライズしたいが、 URL safe にするため、 base64URL を用いて変換するとこうなる。

```
Cache-Fingerprint: Qc+J/w
```




User agents MAY run the steps more than once with different values selected as the parameter used for Golomb-Rice coding, and send the shortest output as the value of the header.

User agent はこのステップを異なる値で複数回実行し、最小の値になるパラメータを探すだろう。


Or it MAY use the result of the following equation rounded to the nearest power of two (2).
もしくは、以下のように二の累乗の近似値を使う。


It can be shown that the parameter chosen using this equation will yield the shortest output when the keys are distributed geometrically.

この近似で選ばれた parameter は、 key が幾何分布している場合 最小の output になる。


```
log2(maximum_value_of_collected_keys / number_of_collected_keys)
```




```
この Cache-Fingerprint-Key の値の導出方法を
> - https://github.com/h2o/h2o/blob/v1.5.3/lib/http2/casper.c#L36 （casper->capcity_bits == 13）に
> - golombset の演算を古いやりかたに
変更したものが、h2o の casper です
```





# casper.js

で、 h2o はリソースを PUSH したリソースについては、この Cookie を付与してクライアントに送ることで、





ところが、 Cookie のライフサイクルとブラウザキャッシュのライフサイクルは別であるため、本来この Cookie はブラウザ自身が管理しているキャッシュを元に付けるのが理想的です。

そのためには、ブラウザ自身がこの仕組みに対応するしか無い訳ですが、Service Worker でキャッシュを管理し、ブラウザのリクエストに Cookie を付与して行くかたちにすれば、この理想に近づけることができます。


今回実装したのはまさしくこれを行う JS です。



動作はこういう感じです。


- 最初のリクエストでサーバは全てのサブリソースを Push する
- Service Worker を登録する
- 次からのリクエストは SW で interapt する
- SW は fetch を発行し、それがブラウザキャッシュヒットする
- 取得したレスポンスを Cache API で保存し、返す
- 次からのリクエストは、 Cache に無いものだけ、キャッシュしたレスポンスのヘッダから fingerprint を計算してヘッダに足す

これにより、 SW で発行した fetch がブラウザキャッシュにヒットしたときに Cache API に移され、ブラウザキャッシュを JS で管理している状態に近づけます。
また、サーバにキャッシュの情報を正確に伝えることで、無駄な Push を減らすことができます。
