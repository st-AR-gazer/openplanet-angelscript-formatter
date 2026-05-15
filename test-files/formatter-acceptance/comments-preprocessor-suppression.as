#if TMNEXT
void Main(){
  // leading comment
  int value=1+2; // trailing comment
  /* block
     comment */
  #if DEPENDENCY
  print("inside");
  #else
  warn("outside");
  #endif

  // opfmt-disable-next-line
  if(true){print("keep me compact");}
  // opfmt-disable-start
  while(value<10){value++;}
  // opfmt-disable-end
  if(value>0){print(value);}
}
#endif
